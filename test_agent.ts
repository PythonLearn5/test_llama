import "dotenv/config";
import { initSettings } from "./src/app/settings";
import { workflowFactory } from "./src/app/workflow";

async function test() {
  initSettings();
  const wf = await workflowFactory({});

  const queries = [
    "信件的最小尺寸是多少",
    "包裹的最大重量是多少",
  ];

  for (const query of queries) {
    console.log(`\n=== Agent query: ${query} ===`);
    const response = await wf.run(query);
    const data = (response as any).data;
    console.log("Result:", data?.result);
  }
}

test();
