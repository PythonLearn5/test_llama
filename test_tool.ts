import "dotenv/config";
import { initSettings } from "./src/app/settings";
import { getIndex } from "./src/app/data";

async function test() {
  initSettings();
  const index = await getIndex();

  const queryEngineTool = index.queryTool({
    options: { similarityTopK: 5 },
    metadata: {
      name: "query_document",
      description: "retrieve info from USPS document",
    },
  });

  const queries = [
    "信件的最小尺寸",
    "What are the minimum size requirements for letters?",
  ];

  for (const query of queries) {
    console.log(`\n=== Tool query: ${query} ===`);
    const result = await queryEngineTool.call({ query });
    console.log("Content:", result.content);
  }
}

test();
