import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "./trpc";
import { poolCommits } from "~/lib/github";
import { loadGithubRepo, generateEmbeddings } from "~/lib/github-loader";

// Calculate credits based on repository size
function calculateCredits(repoInfo: {
  fileCount: number;
  totalSize: number;
  languages: string[];
}): number {
  const baseCredits = Math.ceil(repoInfo.fileCount / 10);
  const sizeMultiplier = Math.ceil(repoInfo.totalSize / (1024 * 1024)); // Size in MB
  const complexityMultiplier = repoInfo.languages.length > 5 ? 1.5 : 1;

  return Math.max(
    1,
    Math.ceil(baseCredits * sizeMultiplier * complexityMultiplier),
  );
}

export const projectRouter = createTRPCRouter({
  createProject: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        githubUrl: z
          .string()
          .url()
          .refine(
            (url) => url.includes("github.com"),
            "Must be a valid GitHub repository URL",
          ),
        githubToken: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // First, get repository info to calculate required credits
      const repoInfo = await loadGithubRepo(input.githubUrl, input.githubToken);
      const requiredCredits = calculateCredits({
        fileCount: repoInfo.length,
        totalSize: repoInfo.reduce(
          (acc, file) => acc + file.metadata.source.length,
          0,
        ),
        languages: repoInfo.map((file) => file.metadata.source.split(".")[1]),
      });

      // Check user credits
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.user.userId! },
        select: { credits: true },
      });

      if (!user || user.credits < requiredCredits) {
        throw new Error(
          `Insufficient credits. This project requires ${requiredCredits} credits. Please purchase more credits to create this project.`,
        );
      }

      // Create project with initial indexing status
      const project = await ctx.db.project.create({
        data: {
          githubUrl: input.githubUrl,
          name: input.name,
          status: "indexing" as const,
          userToProjects: {
            create: {
              userId: ctx.user.userId!,
            },
          },
        },
      });

      // Deduct credits
      await ctx.db.user.update({
        where: { id: ctx.user.userId! },
        data: {
          credits: {
            decrement: requiredCredits,
          },
        },
      });

      // Start indexing in the background
      void (async () => {
        try {
          // Generate embeddings in smaller chunks
          const embeddingResult = await generateEmbeddings(
            repoInfo,
            project.id,
          );
          const validEmbeddings = embeddingResult.successful;

          // Save to database in smaller chunks
          const SAVE_BATCH_SIZE = 3;
          for (let i = 0; i < validEmbeddings.length; i += SAVE_BATCH_SIZE) {
            const batch = validEmbeddings.slice(i, i + SAVE_BATCH_SIZE);

            await Promise.all(
              batch.map(async (embedding) => {
                try {
                  const sourceCodeEmbedding =
                    await ctx.db.sourceCodeEmbedding.create({
                      data: {
                        sourceCode: embedding.sourceCode,
                        fileName: embedding.fileName,
                        summary: embedding.summary,
                        projectId: project.id,
                      },
                    });

                  await ctx.db
                    .$executeRaw`UPDATE "SourceCodeEmbedding" SET "summaryEmbedding" = ${embedding.embedding}::vector WHERE "id" = ${sourceCodeEmbedding.id}`;
                } catch (error) {
                  console.error(`Error saving ${embedding.fileName}:`, error);
                }
              }),
            );

            // Small delay between chunks to prevent rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          // Update project status to completed
          await ctx.db.project.update({
            where: { id: project.id },
            data: { status: "completed" as const },
          });

          // Start commit pooling
          await poolCommits(project.id);
        } catch (error) {
          console.error("Indexing failed:", error);
          await ctx.db.project.update({
            where: { id: project.id },
            data: { status: "failed" },
          });
        }
      })();

      return project;
    }),
  getProjects: protectedProcedure.query(async ({ ctx }) => {
    const projects = await ctx.db.project.findMany({
      where: {
        userToProjects: { some: { userId: ctx.user.userId! } },
        deletedAt: null,
      },
    });
    return projects;
  }),
  getCommits: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        // Start fetching new commits in the background
        void poolCommits(input.projectId).catch((error) => {
          console.error("Error pooling commits:", error);
        });

        // Return existing commits with pagination
        const commits = await ctx.db.commit.findMany({
          where: { projectId: input.projectId },
          orderBy: {
            commitDate: "desc",
          },
          take: input.limit,
          skip: input.cursor,
        });

        // Get total count for pagination metadata
        const totalCount = await ctx.db.commit.count({
          where: { projectId: input.projectId },
        });

        return {
          commits,
          pagination: {
            total: totalCount,
            limit: input.limit,
            offset: input.cursor,
            hasMore: input.cursor + input.limit < totalCount,
            nextCursor:
              input.cursor + input.limit < totalCount
                ? input.cursor + input.limit
                : null,
          },
        };
      } catch (error) {
        console.error("Error fetching commits:", error);
        throw new Error("Failed to fetch commits");
      }
    }),
  saveAnswer: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        question: z.string(),
        answer: z.string(),
        filesReferences: z.any(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.question.create({
        data: {
          projectId: input.projectId,
          question: input.question,
          answer: input.answer,
          filesReferences: input.filesReferences,
          userId: ctx.user.userId!,
        },
      });
    }),
  getQuestions: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const questions = await ctx.db.question.findMany({
        where: { projectId: input.projectId },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: input.limit,
        skip: input.cursor,
      });

      const totalCount = await ctx.db.question.count({
        where: { projectId: input.projectId },
      });

      return {
        questions,
        pagination: {
          total: totalCount,
          limit: input.limit,
          offset: input.cursor,
          hasMore: input.cursor + input.limit < totalCount,
          nextCursor:
            input.cursor + input.limit < totalCount
              ? input.cursor + input.limit
              : null,
        },
      };
    }),
  archiveProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.project.update({
        where: { id: input.projectId },
        data: {
          deletedAt: new Date(),
        },
      });
    }),
  getArchivedProjects: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.project.findMany({
      where: {
        userToProjects: { some: { userId: ctx.user.userId! } },
        deletedAt: { not: null },
      },
      orderBy: {
        deletedAt: "desc",
      },
    });
  }),
  restoreProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.project.update({
        where: { id: input.projectId },
        data: {
          deletedAt: null,
        },
      });
    }),
  deleteProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // First check if the user has access to this project
      const userProject = await ctx.db.userToProject.findFirst({
        where: {
          projectId: input.projectId,
          userId: ctx.user.userId!,
        },
      });

      if (!userProject) {
        throw new Error("You don't have access to this project");
      }

      // Then delete the project
      return await ctx.db.project.delete({
        where: { id: input.projectId },
      });
    }),
});
