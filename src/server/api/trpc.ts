/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 *
 * @see https://trpc.io/docs/server/context
 */
import { auth } from "@clerk/nextjs/server";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { clerkClient } from "@clerk/clerk-sdk-node";

import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  console.log("🔧 Creating tRPC context:", {
    timestamp: new Date().toISOString(),
  });

  const authResult = await auth();
  console.log("🔑 Auth result in context:", {
    userId: authResult.userId,
    sessionId: authResult.sessionId,
    timestamp: new Date().toISOString(),
  });

  // If user is authenticated, ensure they're synced in the database
  if (authResult.userId) {
    try {
      const user = await db.user.findUnique({
        where: { id: authResult.userId },
      });

      if (!user) {
        console.log("🔄 User not found in database, syncing...");
        const clerkUser = await clerkClient.users.getUser(authResult.userId);
        const userEmail = clerkUser.emailAddresses[0]?.emailAddress;

        if (!userEmail) {
          console.error("❌ No email found for user:", authResult.userId);
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'User email not found',
          });
        }

        await db.user.create({
          data: {
            id: authResult.userId,
            emailAddress: userEmail,
            firstName: clerkUser.firstName || "",
            lastName: clerkUser.lastName || "",
            imageUrl: clerkUser.imageUrl || "",
            credits: 50, // Default credits for new users
          },
        });
        console.log("✅ User synced successfully:", {
          userId: authResult.userId,
          email: userEmail,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("❌ Error syncing user in context:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        userId: authResult.userId,
        timestamp: new Date().toISOString(),
      });
      // Don't throw here, let the request proceed
    }
  }

  return {
    db,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const isAuthenticated = t.middleware(async ({ next, ctx }) => {  
  console.log("🔑 Running authentication middleware:", {
    timestamp: new Date().toISOString(),
  });

  const user = await auth();
  console.log("👤 Auth result:", {
    userId: user?.userId,
    sessionId: user?.sessionId,
    timestamp: new Date().toISOString(),
  });

  if (!user) {
    console.error("❌ Authentication failed - no user found");
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you will use to build your tRPC API.
 */
export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthenticated)