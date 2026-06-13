import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { loadGithubRepo } from "~/lib/github-loader";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { repoUrl } = await req.json();
    if (!repoUrl) {
      return NextResponse.json(
        { error: "Repository URL is required" },
        { status: 400 }
      );
    }

    // Load repository to get file count
    const repoFiles = await loadGithubRepo(repoUrl);
    const fileCount = repoFiles.length;

    // Calculate required credits based on file count
    let requiredCredits = 1; // Default for small repos
    if (fileCount > 200) {
      requiredCredits = 100;
    } else if (fileCount > 100) {
      requiredCredits = 50;
    } else if (fileCount > 50) {
      requiredCredits = 25;
    } else if (fileCount > 10) {
      requiredCredits = 10;
    }

    return NextResponse.json({ requiredCredits });
  } catch (error) {
    console.error("Error calculating credits:", error);
    return NextResponse.json(
      { error: "Failed to calculate credits" },
      { status: 500 }
    );
  }
}
