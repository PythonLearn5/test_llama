import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import "dotenv/config";
import { SentenceSplitter, storageContextFromDefaults, VectorStoreIndex } from "llamaindex";
import { initSettings } from "./app/settings";
import { extractPdfImages } from "./app/image-extract";

async function generateDatasource() {
  console.log(`Generating storage context...`);
  const storageContext = await storageContextFromDefaults({
    persistDir: "storage",
  });
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData("data");

  // Extract embedded images from PDFs
  console.log("Extracting embedded PDF images...");
  const imageCache: Record<string, Record<number, string[]>> = {};
  for (const doc of documents) {
    const filePath = doc.metadata?.file_path as string;
    const fileName = doc.metadata?.file_name as string;
    const pageNumber = doc.metadata?.page_number as number;
    if (filePath && fileName && fileName.endsWith(".pdf") && pageNumber) {
      const prefix = fileName.replace(/\.pdf$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
      if (!imageCache[filePath]) {
        try {
          imageCache[filePath] = await extractPdfImages(filePath, prefix);
        } catch (e: any) {
          console.error(`  Failed to extract images from ${fileName}: ${e.message}`);
          imageCache[filePath] = {};
        }
      }
      const imageUrls = imageCache[filePath]?.[pageNumber];
      if (imageUrls && imageUrls.length > 0) {
        doc.metadata.image_urls = imageUrls;
      }
    }
  }

  // Manually split documents into smaller chunks for better retrieval
  const splitter = new SentenceSplitter({ chunkSize: 256, chunkOverlap: 20 });
  (splitter as any).tokenSize = (text: string) => Math.ceil(text.length / 4);
  const nodes = splitter.getNodesFromDocuments(documents);

  // Append image references to each node's text so the LLM can see them in retrieved context
  for (const node of nodes) {
    const imageUrls = node.metadata?.image_urls as string[] | undefined;
    if (imageUrls && imageUrls.length > 0) {
      const page = node.metadata?.page_number as number | undefined;
      const source = node.metadata?.file_name as string | undefined;
      const label = source ? `${source} page ${page}` : `page ${page}`;
      const imageMarkdown = imageUrls
        .map((url, idx) => `![${label} figure ${idx + 1}](${url})`)
        .join("\n");
      node.text = `${node.text}\n\n[Figures on this page:\n${imageMarkdown}]`;
    }
  }

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
