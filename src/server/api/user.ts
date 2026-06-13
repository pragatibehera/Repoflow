import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "./trpc";

export const userRouter = createTRPCRouter({
  getCredits: protectedProcedure.query(async ({ ctx }) => {
    console.log("🔍 Getting credits for user:", {
      userId: ctx.user?.userId,
      timestamp: new Date().toISOString(),
    });

    if (!ctx.user?.userId) {
      console.error("❌ No user ID found in context");
      throw new Error("User not authenticated");
    }

    try {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.user.userId },
        select: { credits: true },
      });

      console.log("📊 Database query result:", {
        found: !!user,
        userId: ctx.user.userId,
        credits: user?.credits,
        timestamp: new Date().toISOString(),
      });

      if (!user) {
        console.error("❌ User not found in database:", {
          userId: ctx.user.userId,
          timestamp: new Date().toISOString(),
        });
        throw new Error("User not found");
      }

      return { credits: user.credits };
    } catch (error) {
      console.error("❌ Error in getCredits:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        userId: ctx.user.userId,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }),

  updateCredits: protectedProcedure
    .input(z.object({ credits: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.userId) {
        throw new Error("User not authenticated");
      }

      const user = await ctx.db.user.update({
        where: { id: ctx.user.userId },
        data: { credits: input.credits },
        select: { credits: true },
      });

      return { credits: user.credits };
    }),
});