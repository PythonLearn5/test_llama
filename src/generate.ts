import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import "dotenv/config";
import { SentenceSplitter, storageContextFromDefaults, VectorStoreIndex } from "llamaindex";
import { initSettings } from "./app/settings";

async function generateDatasource() {
  console.log(`Generating storage context...`);
  const storageContext = await storageContextFromDefaults({
    persistDir: "storage",
  });
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData("data");

  // Manually split documents into smaller chunks for better retrieval
  const splitter = new SentenceSplitter({ chunkSize: 256, chunkOverlap: 20 });
  (splitter as any).tokenSize = (text: string) => Math.ceil(text.length / 4);
  const nodes = splitter.getNodesFromDocuments(documents);
  console.log(`Split ${documents.length} documents into ${nodes.length} chunks.`);

  await VectorStoreIndex.init({
    nodes,
    storageContext,
  });
  console.log("Storage context successfully generated.");
}

(async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  initSettings();

  if (command === "ui") {
    console.error("This project doesn't use any custom UI.");
    return;
  } else {
    if (command !== "datasource") {
      console.error(
        `Unrecognized command: ${command}. Generating datasource by default.`,
      );
    }
    await generateDatasource();
  }
})();
