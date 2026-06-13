import { Octokit } from "octokit";
import { db } from "~/server/db";
import axios from "axios";
import { aiSummariseCommit } from "./gemini";

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

type Response = {
  commitMessage: string;
  commitHash: string;
  commitAuthorName: string;
  commitAuthorAvatar: string;
  commitDate: string;
};

export const getCommitHashes = async (
  githubUrl: string,
): Promise<Response[]> => {
  // Handle both https://github.com/owner/repo and owner/repo formats
  const urlParts = githubUrl.replace(/^https?:\/\//, "").split("/");
  const owner = urlParts[urlParts.length - 2];
  const repo = urlParts[urlParts.length - 1];

  if (!owner || !repo) {
    throw new Error("Invalid GitHub URL");
  }

  console.log(`Fetching commits for ${owner}/${repo}`);
  const { data } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    per_page: 10, // Limit to 10 most recent commits
  });

  console.log(`Found ${data.length} commits`);
  const sortedCommits = data.sort(
    (a: any, b: any) =>
      new Date(b.commit.author.date).getTime() -
      new Date(a.commit.author.date).getTime(),
  );

  return sortedCommits.map((commit: any) => ({
    commitMessage: commit.commit.message || "No message",
    commitHash: commit.sha,
    commitAuthorName: commit.commit?.author?.name || "Unknown",
    commitAuthorAvatar: commit.author?.avatar_url || "",
    commitDate: commit.commit?.author?.date || new Date().toISOString(),
  }));
};

async function getDiffFromGitHub(
  owner: string,
  repo: string,
  commitHash: string,
) {
  try {
    const { data } = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: commitHash,
    });

    // Get the full diff using the patch URL
    const patchResponse = await axios.get(data.url, {
      headers: {
        Accept: "application/vnd.github.v3.diff",
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
    });

    return patchResponse.data;
  } catch (error) {
    console.error(`Failed to fetch diff for commit ${commitHash}:`, error);
    throw error;
  }
}

async function summarizeCommit(githubUrl: string, commitHash: string) {
  try {
    // Handle both https://github.com/owner/repo and owner/repo formats
    const urlParts = githubUrl.replace(/^https?:\/\//, "").split("/");
    const owner = urlParts[urlParts.length - 2];
    const repo = urlParts[urlParts.length - 1];

    if (!owner || !repo) {
      throw new Error("Invalid GitHub URL");
    }

    console.log(`Fetching diff for commit ${commitHash} from ${owner}/${repo}`);
    const diff = await getDiffFromGitHub(owner, repo, commitHash);

    if (!diff) {
      console.log(`No diff data found for commit ${commitHash}`);
      return "No changes found in this commit";
    }

    console.log(`Generating summary for commit ${commitHash}`);
    const summary = await aiSummariseCommit(diff);

    if (!summary) {
      console.log(`Failed to generate summary for commit ${commitHash}`);
      return "Unable to generate summary for this commit";
    }

    return summary.replace(/^\s*\*\s*/gm, "").trim();
  } catch (error) {
    console.error(`Error processing commit ${commitHash}:`, error);
    return "Failed to process this commit";
  }
}

export const poolCommits = async (projectId: string) => {
  try {
    const { project, githubUrl } = await fetchProjectGithubUrl(projectId);
    console.log(
      `Processing commits for project: ${project.name} (${githubUrl})`,
    );

    const commitHashes = await getCommitHashes(githubUrl);
    const unprocessedCommits = await filterUnprocessedCommits(
      projectId,
      commitHashes,
    );

    if (unprocessedCommits.length === 0) {
      console.log("No new commits to process");
      return [];
    }

    console.log(`Processing ${unprocessedCommits.length} new commits`);
    const batchSize = 3; // Process 3 commits at a time to avoid rate limits
    const results = [];

    for (let i = 0; i < unprocessedCommits.length; i += batchSize) {
      const batch = unprocessedCommits.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(unprocessedCommits.length / batchSize)}`,
      );

      // Process each commit in the batch sequentially to avoid overwhelming the API
      for (const commit of batch) {
        try {
          const summary = await summarizeCommit(githubUrl, commit.commitHash);
          const result = {
            commitMessage: commit.commitMessage,
            commitHash: commit.commitHash,
            commitAuthorName: commit.commitAuthorName,
            commitAuthorAvatar: commit.commitAuthorAvatar,
            commitDate: commit.commitDate,
            summary,
            projectId,
          };

          // Save each commit immediately after processing
          await db.commit.create({ data: result });
          results.push(result);

          console.log(`Successfully processed commit: ${commit.commitHash}`);
          // Add a small delay between commits to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(
            `Failed to process commit ${commit.commitHash}:`,
            error,
          );
        }
      }
    }

    console.log(`Successfully processed ${results.length} commits`);
    return results;
  } catch (error) {
    console.error("Error in poolCommits:", error);
    throw error;
  }
};

const fetchProjectGithubUrl = async (projectId: string) => {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      githubUrl: true,
      name: true,
    },
  });

  if (!project) {
    throw new Error(`Project with ID ${projectId} not found`);
  }

  if (!project.githubUrl) {
    throw new Error(
      `No GitHub URL configured for project "${project.name}". Please connect a GitHub repository first.`,
    );
  }

  return {
    project,
    githubUrl: project.githubUrl,
  };
};

const filterUnprocessedCommits = async (
  projectId: string,
  commitHashes: Response[],
) => {
  const processedCommits = await db.commit.findMany({
    where: {
      projectId,
    },
  });
  const unprocessedCommits = commitHashes.filter(
    (commit) =>
      !processedCommits.some((c) => c.commitHash === commit.commitHash),
  );
  return unprocessedCommits;
};
