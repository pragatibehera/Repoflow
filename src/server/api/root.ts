import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { projectRouter } from "./project";
import { userRouter } from "./user";

export const appRouter = createTRPCRouter({
  project: projectRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);