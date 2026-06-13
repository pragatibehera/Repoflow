import { GoogleGenerativeAI } from "@google/generative-ai";
import { Document } from "@langchain/core/documents";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// FREE TIER optimization - Best models available for free
const getModel = (task: "summarize" | "commit" | "qa" | "complex") => {
  switch (task) {
    case "summarize":
    case "commit":
      // Use 2.0 Flash-Lite for bulk processing (FREE + highest rate limits)
      return genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    case "qa":
    case "complex":
      // Use 2.0 Flash for complex reasoning (FREE + better performance)
      return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    default:
      return genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
  }
};

export const aiSummariseCommit = async (diff: string) => {
  const model = getModel("commit"); // Use Flash-Lite for cost savings
  const response = await model.generateContent([
    `You are an expert programmer, and you are trying to summarize a git diff.
Reminders about the git diff format:
For every file, there are a few metadata lines, like (for example):
\`\`\`
diff --git a/lib/index.js b/lib/index.js
index aadf691..bfef603 100644
--- a/lib/index.js
+++ b/lib/index.js
\`\`\`
This means that \`lib/index.js\` was modified in this commit. Note that this is only an example.
Then there is a specifier of the lines that were modified.
A line starting with \`+\` means it was added.
A line that starts with \`-\` means that line was deleted.
A line that starts with neither \`+\` nor \`-\` is code given for context and better understanding.
It is not part of the diff.
[...]
EXAMPLE SUMMARY COMMENTS:
* Raised the amount of returned recordings from \`10\` to \`100\` [packages/server/recordings_api.ts],[packages/server/constants.ts].
* Fixed a typo in the GitHub action name [.github/workflows/gpt-commit-summarizer.yml].
* Moved the \`octokit\` initialization to a separate file [src/octokit.ts]. [src/index.ts]
* Added an OpenAI API for completions [packages/utils/apis/openai.ts].
* Lowered numeric tolerance for test files.
\`\`\`
Most commits will have less comments than this examples list. The last comment does not include the file names, because there were more than two relevant files in the hypothetical commit.
Do not include parts of the example in your summary. It is given only as an example of appropriate comments.
Please summarise the following diff file:\n\n${diff}`,
  ]);

  return response.response.text();
};

export async function summariseCode(doc: Document) {
  console.log("Get Summary", doc.metadata.source);

  try {
    const model = getModel("summarize"); // Use Flash-Lite for bulk processing
    const code = doc.pageContent.slice(0, 10000);
    const response = await model.generateContent([
      `You are an intelligent senior engineer who specialises in onboarding junior engineers onto project`,
      `You are onboarding a junior engineer onto a project and explaining to them the purpose of the ${doc.metadata.source} file
      Here is the Code:
      ---
      ${code}
      ---
      Give the summary no more than 100 words of the code above`,
    ]);

    return response.response.text();
  } catch (error) {
    return "";
  }
}

// Q&A function using Flash for better reasoning
export async function generateQAResponse(prompt: string) {
  const model = getModel("qa"); // Use Flash for complex reasoning
  const response = await model.generateContent([prompt]);
  return response.response.text();
}

export async function generateEmbedding(summary: string) {
  const model = genAI.getGenerativeModel({
    model: "text-embedding-004",
  });
  const result = await model.embedContent(summary);
  const embedding = result.embedding;
  return embedding.values;
}
