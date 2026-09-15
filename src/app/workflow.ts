import { agent } from "@llamaindex/workflow";
import { getIndex } from "./data";

export const workflowFactory = async (reqBody: any) => {
  const index = await getIndex(reqBody?.data);

  const queryEngineTool = index.queryTool({
    options: { similarityTopK: 5 },
    metadata: {
      name: "query_document",
      description: `This tool can retrieve information from the USPS Domestic Mail Manual about physical standards for letters, cards, flats, and parcels`,
    },
  });

  return agent({
    tools: [queryEngineTool],
    systemPrompt: `You are a helpful assistant that answers questions based on the retrieved documents. Use the query_document tool to look up information. If the tool returns an answer, use it to respond to the user. If the tool returns no relevant information, say you don't know.`,
  });
};
