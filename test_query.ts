import "dotenv/config";
import { initSettings } from "./src/app/settings";
import { getIndex } from "./src/app/data";

async function test() {
  initSettings();
  const index = await getIndex();
  const queryEngine = index.asQueryEngine({ similarityTopK: 5 });

  const queries = [
    "信件的最小尺寸是多少",
    "包裹的最大重量是多少",
  ];

  for (const query of queries) {
    console.log(`\n=== Query: ${query} ===`);
    const response = await queryEngine.query({ query });
    console.log("Response:", response.response);
  }
}

test();
