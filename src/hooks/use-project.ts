import React, { useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { useLocalStorage } from "usehooks-ts";
import type { Project } from "~/types/project";

export default function useProject() {
  const [projectId, setProjectId] = useLocalStorage<string>(
    "repoflow-projectId",
    "",
  );

  // Track if we're currently resetting projectId to prevent race conditions
  const isResettingProjectId = useRef(false);
  const {
    data: projects,
    isLoading,
    refetch,
  } = api.project.getProjects.useQuery();
  const project = projects?.find((project) => project.id === projectId) as
    | Project
    | undefined;

  // Poll for project status changes if project is being indexed
  useEffect(() => {
    if (!project || project.status !== "indexing") return;

    const pollInterval = setInterval(() => {
      void refetch();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [project, refetch]);

  // Debug logging
  useEffect(() => {
    console.log("useProject hook - projectId:", projectId);
    console.log("useProject hook - projects:", projects);
    console.log("useProject hook - selected project:", project);
  }, [projectId, projects, project]);

  // If projectId doesn't match any project, reset it (with race condition protection)
  useEffect(() => {
    // Prevent race conditions by checking if we're already resetting
    if (isResettingProjectId.current || isLoading) {
      return;
    }

    // Only proceed if we have projects and current projectId doesn't match any
    if (projects?.length && projectId && !project) {
      console.warn(
        "Project ID doesn't match any available project, resetting to first project",
      );

      const firstProjectId = projects[0]?.id;
      if (firstProjectId && firstProjectId !== projectId) {
        isResettingProjectId.current = true;
        setProjectId(firstProjectId);

        // Reset the flag after state update completes
        setTimeout(() => {
          isResettingProjectId.current = false;
        }, 0);
      }
    }
  }, [projectId, projects, project, isLoading]);

  return {
    projects,
    project,
    projectId,
    setProjectId,
    isLoading,
    refetch,
  };
}
