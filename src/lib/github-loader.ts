import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { Document } from "@langchain/core/documents";
import { generateEmbedding, summariseCode } from "./gemini";
import { db } from "~/server/db";

// Custom error types for better error handling
export class RepositoryLoadError extends Error {
  constructor(
    message: string,
    public readonly repositoryUrl: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "RepositoryLoadError";
  }
}

export class EmbeddingGenerationError extends Error {
  constructor(
    message: string,
    public readonly fileName?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "EmbeddingGenerationError";
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly service?: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly service?: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// Result types for better type safety
export interface EmbeddingResult {
  summary: string;
  embedding: number[];
  sourceCode: string;
  fileName: string;
}

export interface ProcessingResult {
  successful: EmbeddingResult[];
  failed: Array<{
    fileName: string;
    error: string;
  }>;
  stats: {
    totalFiles: number;
    successCount: number;
    failureCount: number;
    processingTimeMs: number;
  };
}

// Adaptive batch processing configuration
const getBatchConfig = (totalFiles: number) => {
  let batchSize: number;
  let delay: number;

  if (totalFiles <= 20) {
    batchSize = 10;
    delay = 1000;
  } else if (totalFiles <= 100) {
    batchSize = 15;
    delay = 2000;
  } else if (totalFiles <= 500) {
    batchSize = 20;
    delay = 3000;
  } else {
    batchSize = 25;
    delay = 4000;
  }

  return { batchSize, delay };
};

// Queue processing status for background jobs
interface ProcessingJob {
  projectId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: {
    current: number;
    total: number;
    phase: "loading" | "processing" | "saving";
  };
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// Simple in-memory job queue
const processingQueue = new Map<string, ProcessingJob>();

async function processBatch<T>(
  items: T[],
  processor: (item: T) => Promise<any>,
) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    try {
      const result = await processor(item);
      if (result) {
        results.push(result);
      }
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error(`Error processing item ${i}:`, error);
    }
  }
  return results;
}

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  delay: number,
  processor: (item: T) => Promise<any>,
  onProgress?: (current: number, total: number) => void,
) {
  const results = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;

    console.log(
      `\nProcessing batch ${currentBatch} of ${totalBatches} (${batch.length} items)`,
    );

    const batchResults = await processBatch(batch, processor);
    results.push(...batchResults);

    if (onProgress) {
      onProgress(i + batch.length, items.length);
    }

    if (i + batchSize < items.length) {
      console.log(`Waiting ${delay / 1000} seconds before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return results;
}

// Enhanced error recovery with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(
        `Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

// Background job management functions
export const getJobStatus = (projectId: string): ProcessingJob | undefined => {
  return processingQueue.get(projectId);
};

export const updateJobProgress = (
  projectId: string,
  progress: Partial<ProcessingJob["progress"]>,
  status?: ProcessingJob["status"],
) => {
  const job = processingQueue.get(projectId);
  if (job) {
    job.progress = { ...job.progress, ...progress };
    if (status) job.status = status;
    processingQueue.set(projectId, job);
  }
};

export const loadGithubRepo = async (
  githubUrl: string,
  githubToken?: string,
): Promise<Document[]> => {
  if (!githubUrl || typeof githubUrl !== "string") {
    throw new ValidationError(
      "Repository URL is required and must be a string",
      "githubUrl",
    );
  }

  if (!githubUrl.includes("github.com")) {
    throw new ValidationError(
      "Must be a valid GitHub repository URL",
      "githubUrl",
    );
  }

  try {
    new URL(githubUrl);
  } catch {
    throw new ValidationError("Invalid URL format", "githubUrl");
  }

  console.log(`Loading repository: ${githubUrl}`);

  const loader = new GithubRepoLoader(githubUrl, {
    accessToken: githubToken || "",
    branch: "main",
    ignoreFiles: [
      ".gitignore",
      "README.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "LICENSE.md",
      "PULL_REQUEST_TEMPLATE.md",
      "ISSUE_TEMPLATE.md",
      "SECURITY.md",
      "FUNDING.yml",
      "SUPPORT.md",
      "CHANGELOG.md",
      "CONTRIBUTORS.md",
      "AUTHORS.md",
      "HISTORY.md",
      "UPGRADING.md",
      "TODO.md",
      "TODO",
      "CHANGELOG",
      "UPGRADING",
      "HISTORY",
      "AUTHORS",
      "CONTRIBUTORS",
      "SECURITY",
      "SUPPORT",
      "FUNDING",
      "ISSUE_TEMPLATE",
      "PULL_REQUEST_TEMPLATE",
      "LICENSE",
      "CODE_OF_CONDUCT",
      "CONTRIBUTING",
      "README",
      "LICENSE.txt",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      ".DS_Store",
      "Thumbs.db",
      ".env",
      ".env.local",
      ".env.development",
      ".env.test",
      ".env.production",
    ],
    recursive: true,
    unknown: "warn",
    maxConcurrency: 5,
  });

  try {
    const docs = await loader.load();

    if (!Array.isArray(docs)) {
      throw new RepositoryLoadError(
        "Repository loader returned invalid data format",
        githubUrl,
      );
    }

    if (docs.length === 0) {
      throw new RepositoryLoadError(
        "Repository appears to be empty or contains no accessible files",
        githubUrl,
      );
    }

    console.log(`Successfully loaded ${docs.length} files from repository`);
    return docs;
  } catch (error) {
    if (error instanceof RepositoryLoadError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
      throw new RepositoryLoadError(
        "Repository not found. Please check the URL and ensure the repository is public or you have access.",
        githubUrl,
        error instanceof Error ? error : undefined,
      );
    }

    if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
      throw new RepositoryLoadError(
        "Access denied. Repository may be private or rate limit exceeded. Please provide a valid GitHub token.",
        githubUrl,
        error instanceof Error ? error : undefined,
      );
    }

    if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
      throw new RepositoryLoadError(
        "Authentication failed. Please check your GitHub token.",
        githubUrl,
        error instanceof Error ? error : undefined,
      );
    }

    if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
      throw new RateLimitError(
        "GitHub API rate limit exceeded. Please try again later or provide a GitHub token.",
        undefined,
        "GitHub API",
      );
    }

    if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("ETIMEDOUT")
    ) {
      throw new RepositoryLoadError(
        "Request timeout. The repository may be too large or GitHub API is slow. Please try again.",
        githubUrl,
        error instanceof Error ? error : undefined,
      );
    }

    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("network")
    ) {
      throw new RepositoryLoadError(
        "Network error. Please check your internet connection and try again.",
        githubUrl,
        error instanceof Error ? error : undefined,
      );
    }

    throw new RepositoryLoadError(
      `Failed to load repository: ${errorMessage}`,
      githubUrl,
      error instanceof Error ? error : undefined,
    );
  }
};

export const generateEmbeddings = async (
  docs: Document[],
  projectId?: string,
): Promise<ProcessingResult> => {
  if (!docs || !Array.isArray(docs)) {
    throw new ValidationError("Documents must be provided as an array", "docs");
  }

  if (docs.length === 0) {
    throw new ValidationError(
      "No documents provided for embedding generation",
      "docs",
    );
  }

  const startTime = Date.now();
  const successful: EmbeddingResult[] = [];
  const failed: Array<{ fileName: string; error: string }> = [];

  console.log(
    `\nGenerating summaries and embeddings for ${docs.length} files...`,
  );

  try {
    const { batchSize, delay } = getBatchConfig(docs.length);
    console.log(
      `Using adaptive batching: ${batchSize} files per batch, ${delay}ms delay`,
    );

    const processFile = async (
      doc: Document,
    ): Promise<EmbeddingResult | null> => {
      if (!doc?.metadata?.source) {
        const error = "Document missing required metadata.source";
        failed.push({ fileName: "unknown", error });
        return null;
      }

      return await withRetry(
        async () => {
          console.log(`Processing ${doc.metadata.source}`);

          try {
            const summary = await summariseCode(doc);
            if (
              !summary ||
              typeof summary !== "string" ||
              summary.trim().length === 0
            ) {
              throw new EmbeddingGenerationError(
                "Failed to generate valid summary",
                doc.metadata.source,
              );
            }

            const embedding = await generateEmbedding(summary);
            if (!Array.isArray(embedding) || embedding.length === 0) {
              throw new EmbeddingGenerationError(
                "Failed to generate valid embedding vector",
                doc.metadata.source,
              );
            }

            console.log(`✅ Successfully processed ${doc.metadata.source}`);
            return {
              summary,
              embedding,
              sourceCode: JSON.parse(JSON.stringify(doc.pageContent)),
              fileName: doc.metadata.source,
            };
          } catch (error) {
            let errorMessage: string;

            if (error instanceof RateLimitError) {
              errorMessage = `AI service rate limit exceeded${error.retryAfter ? ` (retry after ${error.retryAfter}s)` : ". Please try again later."}`;
              throw new EmbeddingGenerationError(
                errorMessage,
                doc.metadata.source,
                error,
              );
            } else if (error instanceof APIError) {
              errorMessage = `AI service error: ${error.message}${error.statusCode ? ` (Status: ${error.statusCode})` : ""}`;
              throw new EmbeddingGenerationError(
                errorMessage,
                doc.metadata.source,
                error,
              );
            } else if (error instanceof EmbeddingGenerationError) {
              throw error;
            } else {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              throw new EmbeddingGenerationError(
                `Unexpected error during processing: ${errorMsg}`,
                doc.metadata.source,
                error instanceof Error ? error : undefined,
              );
            }
          }
        },
        3,
        2000,
      ).catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        failed.push({ fileName: doc.metadata.source, error: errorMessage });
        console.error(
          `❌ Failed to process ${doc.metadata.source}: ${errorMessage}`,
        );
        return null;
      });
    };

    const onProgress = (current: number, total: number) => {
      if (projectId) {
        updateJobProgress(projectId, { current, total, phase: "processing" });
      }
      console.log(
        `Progress: ${current}/${total} files processed (${Math.round((current / total) * 100)}%)`,
      );
    };

    const results = await processInBatches(
      docs,
      batchSize,
      delay,
      processFile,
      onProgress,
    );

    for (const result of results) {
      if (result !== null) {
        successful.push(result);
      }
    }

    const processingTimeMs = Date.now() - startTime;

    console.log(`\nEmbedding generation completed:`);
    console.log(`- Total files: ${docs.length}`);
    console.log(`- Successfully processed: ${successful.length}`);
    console.log(`- Failed: ${failed.length}`);
    console.log(`- Processing time: ${processingTimeMs}ms`);

    if (failed.length > 0) {
      console.warn("\nFailed files:");
      failed.forEach(({ fileName, error }) => {
        console.warn(`  - ${fileName}: ${error}`);
      });
    }

    return {
      successful,
      failed,
      stats: {
        totalFiles: docs.length,
        successCount: successful.length,
        failureCount: failed.length,
        processingTimeMs,
      },
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof RateLimitError) {
      throw new EmbeddingGenerationError(
        `Embedding generation failed due to rate limiting: ${error.message}`,
        undefined,
        error,
      );
    }

    if (error instanceof APIError) {
      throw new EmbeddingGenerationError(
        `Embedding generation failed due to API error: ${error.message}`,
        undefined,
        error,
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new EmbeddingGenerationError(
      `Critical failure during embedding generation: ${errorMessage}`,
      undefined,
      error instanceof Error ? error : undefined,
    );
  }
};

export const indexGithubRepo = async (
  projectId: string,
  githubUrl: string,
  githubToken?: string,
): Promise<ProcessingResult> => {
  if (!projectId || typeof projectId !== "string") {
    throw new ValidationError(
      "Project ID is required and must be a string",
      "projectId",
    );
  }

  console.log(`Starting indexing for repository: ${githubUrl}`);

  const job: ProcessingJob = {
    projectId,
    status: "processing",
    progress: { current: 0, total: 0, phase: "loading" },
    startedAt: new Date(),
  };
  processingQueue.set(projectId, job);

  try {
    updateJobProgress(projectId, { phase: "loading" });
    const docs = await loadGithubRepo(githubUrl, githubToken);
    console.log(`\nLoaded ${docs.length} files from repository`);

    updateJobProgress(projectId, { total: docs.length, phase: "processing" });

    const embeddingResult = await generateEmbeddings(docs, projectId);
    const { successful: validEmbeddings, failed: failedEmbeddings } =
      embeddingResult;

    console.log(`\nProcessing completed:`);
    console.log(`- Total files: ${docs.length}`);
    console.log(`- Successfully processed: ${validEmbeddings.length}`);
    console.log(`- Failed: ${failedEmbeddings.length}`);

    if (validEmbeddings.length === 0) {
      throw new EmbeddingGenerationError(
        "No files were successfully processed. Unable to create embeddings for any file in the repository.",
      );
    }

    console.log("\nSaving to database...");
    updateJobProgress(projectId, {
      current: 0,
      total: validEmbeddings.length,
      phase: "saving",
    });

    let savedCount = 0;
    const dbErrors: Array<{ fileName: string; error: string }> = [];

    const saveBatchSize = Math.min(
      validEmbeddings.length <= 50
        ? 15
        : validEmbeddings.length <= 200
          ? 20
          : 25,
      validEmbeddings.length,
    );

    for (let i = 0; i < validEmbeddings.length; i += saveBatchSize) {
      const batch = validEmbeddings.slice(i, i + saveBatchSize);
      console.log(
        `\nSaving batch ${Math.floor(i / saveBatchSize) + 1} of ${Math.ceil(validEmbeddings.length / saveBatchSize)}`,
      );

      await Promise.all(
        batch.map(async (embedding) => {
          return await withRetry(
            async () => {
              try {
                const sourceCodeEmbedding = await db.sourceCodeEmbedding.create(
                  {
                    data: {
                      sourceCode: embedding.sourceCode,
                      fileName: embedding.fileName,
                      summary: embedding.summary,
                      projectId,
                    },
                  },
                );

                await db.$executeRaw`UPDATE "SourceCodeEmbedding" SET "summaryEmbedding" = ${embedding.embedding}::vector WHERE "id" = ${sourceCodeEmbedding.id}`;
                savedCount++;

                updateJobProgress(projectId, { current: savedCount });
                console.log(
                  `✅ Saved ${embedding.fileName} (${savedCount}/${validEmbeddings.length})`,
                );
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                dbErrors.push({
                  fileName: embedding.fileName,
                  error: errorMessage,
                });

                if (
                  errorMessage.includes("unique constraint") ||
                  errorMessage.includes("duplicate")
                ) {
                  throw new DatabaseError(
                    `Duplicate entry for ${embedding.fileName}`,
                    "create",
                    error instanceof Error ? error : undefined,
                  );
                } else if (
                  errorMessage.includes("connection") ||
                  errorMessage.includes("timeout")
                ) {
                  throw new DatabaseError(
                    `Database connection issue while saving ${embedding.fileName}`,
                    "create",
                    error instanceof Error ? error : undefined,
                  );
                } else {
                  throw new DatabaseError(
                    `Failed to save ${embedding.fileName}: ${errorMessage}`,
                    "create",
                    error instanceof Error ? error : undefined,
                  );
                }
              }
            },
            2,
            1000,
          );
        }),
      );

      if (i + saveBatchSize < validEmbeddings.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const completedJob = processingQueue.get(projectId);
    if (completedJob) {
      completedJob.status = "completed";
      completedJob.completedAt = new Date();
      processingQueue.set(projectId, completedJob);
    }

    const processingTimeMs = Date.now() - job.startedAt.getTime();

    console.log(`\nIndexing completed:`);
    console.log(`- Total files saved: ${savedCount}`);
    console.log(`- Failed to save: ${validEmbeddings.length - savedCount}`);
    console.log(`- Processing time: ${processingTimeMs}ms`);

    if (dbErrors.length > 0) {
      console.warn("\nDatabase save errors:");
      dbErrors.forEach(({ fileName, error }) => {
        console.warn(`  - ${fileName}: ${error}`);
      });
    }

    return {
      successful: validEmbeddings.slice(0, savedCount),
      failed: [...failedEmbeddings, ...dbErrors],
      stats: {
        totalFiles: docs.length,
        successCount: savedCount,
        failureCount: docs.length - savedCount,
        processingTimeMs,
      },
    };
  } catch (error) {
    const processingTimeMs = Date.now() - job.startedAt.getTime();
    let finalError: Error;

    if (
      error instanceof ValidationError ||
      error instanceof RepositoryLoadError ||
      error instanceof EmbeddingGenerationError ||
      error instanceof DatabaseError ||
      error instanceof RateLimitError ||
      error instanceof APIError
    ) {
      finalError = error;
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      finalError = new Error(`Indexing failed: ${errorMessage}`);
    }

    const failedJob = processingQueue.get(projectId);
    if (failedJob) {
      failedJob.status = "failed";
      failedJob.error = finalError.message;
      failedJob.completedAt = new Date();
      processingQueue.set(projectId, failedJob);
    }

    console.error(
      `Error during indexing (${processingTimeMs}ms):`,
      finalError.message,
    );
    throw finalError;
  }
};
