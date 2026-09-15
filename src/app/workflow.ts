import { agent } from "@llamaindex/workflow";
import { getIndex } from "./data";

export const workflowFactory = async (reqBody: any) => {
  const index = await getIndex(reqBody?.data);

  const queryEngineTool = index.queryTool({
    options: { similarityTopK: 5 },
    metadata: {
      name: "query_document",
      description: `This tool can retrieve information from documents in the knowledge base, including USPS Domestic Mail Manual and the Attention Is All You Need paper`,
    },
  });

  return agent({
    tools: [queryEngineTool],
    systemPrompt: `You are a helpful assistant that answers questions based on the retrieved documents. Use the query_document tool to look up information. If the tool returns an answer, use it to respond to the user. If the tool returns no relevant information, say you don't know.

When the answer contains tabular data (such as model comparisons, BLEU scores, configuration parameters), format it as a Markdown table for clear presentation.

The retrieved context may contain embedded figure references in the format: [Figures on this page: ![description](image_url)]. When you find these, include the relevant figures in your response using Markdown image syntax: ![description](image_url). Include figures especially when the user asks about figures, diagrams, architecture, or visual content from the documents. Pick the most relevant figure(s) — do not include all figures if only one is relevant.`,
  });
};
