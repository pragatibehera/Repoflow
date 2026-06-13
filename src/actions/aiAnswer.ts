/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/await-thenable */
"use server";
import { streamText } from "ai";
import { createStreamableValue } from "ai/rsc";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateEmbedding } from "~/lib/gemini";
import { db } from "~/server/db";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function askQuestion(question: string, projectId: string) {
  const stream = createStreamableValue();
  const queryVector = await generateEmbedding(question);
  const vectorQuery = `[${queryVector.join(",")}]`;

  // Cast the result to the defined type
  const result = (await db.$queryRaw`
    SELECT "fileName", "sourceCode", "summary", 1-("summaryEmbedding" <=> ${vectorQuery}::vector) AS Similarity
    FROM "SourceCodeEmbedding"
    WHERE 1-("summaryEmbedding" <=> ${vectorQuery}::vector) > .5
    AND "projectId"=${projectId}
    ORDER BY Similarity DESC
    LIMIT 10
    `) as { fileName: string; sourceCode: string; summary: string }[];
  let context = "";

  for (const doc of result) {
    context += `source: ${doc.fileName}\n code content:${doc.sourceCode}\n summary of file: ${doc.summary}\n\n`;
  }
  void (async () => {
    try {
      const { textStream } = await streamText({
        model: google("gemini-2.0-flash"),
        prompt: `You are an AI code assistant who answers questions about the codebase. Your target audience is a technical intern who is looking to understand the codebase.
          
          AI assistant is a brand new, powerful, human-like artificial intelligence. The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
          
          AI is a well-behaved and well-mannered individual.
          AI is always friendly, kind, and inspiring, and he is eager to provide vivid and thoughtful responses to the user.
          
          AI has the sum of all knowledge in their brain, and is able to accurately answer nearly any question about any topic in conversation.
          
          If the question is asking about code or a specific file, AI will provide the detailed answer, giving step by step instructions, including code snippets.
          
          START CONTEXT BLOCK
          ${context}
          END OF CONTEXT BLOCK
          
          START QUESTION
          ${question}
          END OF QUESTION
          
          AI assistant will take into account any CONTEXT BLOCK that is provided in a conversation.
          If the context does not provide the answer to the question, the AI assistant will say, "I'm sorry, I don't have enough context or available info to answer." The assistant will not apologize for previous responses, but instead, indicate it cannot infer the missing context.
          
          AI assistant won't invent anything that is not drawn directly from the context. Answer in markdown syntax, with code snippets if needed. Be as detailed as possible when answering a technical question.`,
      });

      for await (const delta of textStream) {
        stream.update(delta);
      }
      stream.done();
    } catch (error) {
      console.error("Error generating response:", error);
      stream.update("An error occurred while generating the response.");
      stream.done();
    }
  })();

  return {
    output: stream.value,
    filesReferences: result,
  };
}
