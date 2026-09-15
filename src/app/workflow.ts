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
    includeSourceNodes: true,
  });

  return agent({
    tools: [queryEngineTool],
    systemPrompt: `You are a helpful assistant that answers questions strictly based on the retrieved documents. If the answer cannot be found in the documents, say you don't know. Do not use your own knowledge to answer — always use the query_document tool to look up information first.`,
  });
};
