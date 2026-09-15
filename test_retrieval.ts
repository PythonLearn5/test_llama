import "dotenv/config";
import { initSettings } from "./src/app/settings";
import { getIndex } from "./src/app/data";

async function test() {
  initSettings();
  const index = await getIndex();
  const retriever = index.asRetriever({ similarityTopK: 5 });

  const queries = [
    "What are the minimum size requirements for letters?",
    "信件的最小尺寸是多少",
    "包裹的最大重量是多少",
  ];

  for (const query of queries) {
    console.log(`\n=== Query: ${query} ===`);
    const nodes = await retriever.retrieve(query);
    console.log(`Retrieved ${nodes.length} nodes:\n`);
    nodes.forEach((node, i) => {
      const text = node.node?.getContent?.() ?? "no content";
      console.log(`--- Node ${i + 1} (score: ${node.score?.toFixed(4)}) ---`);
      console.log(text.substring(0, 200));
      console.log("---\n");
    });
  }
}

test();
