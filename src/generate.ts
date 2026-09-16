import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import "dotenv/config";
import { SentenceSplitter, storageContextFromDefaults, VectorStoreIndex } from "llamaindex";
import { initSettings } from "./app/settings";
import { extractPdfImages } from "./app/image-extract";
import { extractDocxImages } from "./app/docx-extract";
import { mineruParsePdf } from "./app/mineru-client";

async function generateDatasource() {
  console.log(`Generating storage context...`);
  const storageContext = await storageContextFromDefaults({
    persistDir: "storage",
  });
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData("data");

  // --- Pre-compute per-PDF list of page numbers where SimpleDirectoryReader got
  //     zero text ("image-based / scanned pages"). Pass this to extractPdfImages so it
  //     can skip whole-page scan rasters (Strategy 1) for those pages, and to
  //     MinerU so it can replace empty pages with OCR text.
  const emptyPdfPages: Record<string, number[]> = {};
  for (const doc of documents) {
    const filePath = doc.metadata?.file_path as string;
    const fileName = doc.metadata?.file_name as string;
    const pageNumber = doc.metadata?.page_number as number;
    if (!filePath || !fileName || !fileName.endsWith(".pdf") || !pageNumber) continue;
    const text = (doc as any).text || doc.getContent?.() || "";
    if (text.trim().length === 0) {
      (emptyPdfPages[filePath] ||= []).push(pageNumber);
    }
  }

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
          imageCache[filePath] = await extractPdfImages(filePath, prefix, {
            emptyPageNumbers: emptyPdfPages[filePath],
          });
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

  // MinerU OCR: replace empty text pages of scanned/image-based PDFs with MinerU MD
  console.log("Running MinerU OCR for image-based PDFs...");
  const mineruCache: Record<string, { md: string; imageUrls: string[] }> = {};
  for (const [filePath, pages] of Object.entries(emptyPdfPages)) {
    const fileName = filePath.split(/[\\/]/).pop()!;
    if (!mineruCache[filePath]) {
      const prefix = fileName.replace(/\.pdf$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
      try {
        const r = await mineruParsePdf(filePath, prefix);
        mineruCache[filePath] = {
          md: r.pages[0]?.text || "",
          imageUrls: r.pages[0]?.imageUrls || [],
        };
        console.log(`  ${fileName}: MinerU MD ${mineruCache[filePath].md.length} chars, ${mineruCache[filePath].imageUrls.length} images`);
      } catch (e: any) {
        console.error(`  MinerU failed for ${fileName}: ${e.message}`);
        mineruCache[filePath] = { md: "", imageUrls: [] };
      }
    }
    const { md, imageUrls } = mineruCache[filePath];
    // Distribute MD across empty pages evenly (MinerU doesn't return page splits),
    // split by `# ` headings and assign each empty page a chunk.
    const headings = md.split(/\n(?=#[#]?\s)/).filter(s => s.trim().length > 0);
    const perPage = Math.max(1, Math.ceil(headings.length / Math.max(1, pages.length)));
    for (let i = 0; i < pages.length; i++) {
      const pageChunk = headings.slice(i * perPage, (i + 1) * perPage).join("\n") || (i === 0 ? md : "");
      const pn = pages[i];
      const doc = documents.find(
        (d: any) => d.metadata?.file_path === filePath && d.metadata?.page_number === pn
      );
      if (doc) {
        doc.text = pageChunk;
        // Preserve any images from extractPdfImages, then add MinerU images
        const existing = (doc.metadata.image_urls as string[]) || [];
        doc.metadata.image_urls = Array.from(new Set([...existing, ...imageUrls]));
      }
    }
  }

  // Extract embedded images from DOCX files, and OCR any full-page screenshot images
  console.log("Extracting embedded DOCX images (+ screenshot OCR)...");
  const docxCache: Record<string, { imageUrls: string[]; allOcrTexts: string[] }> = {};
  for (const doc of documents) {
    const filePath = doc.metadata?.file_path as string;
    const fileName = doc.metadata?.file_name as string;
    if (filePath && fileName && fileName.endsWith(".docx")) {
      const prefix = fileName.replace(/\.docx$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
      if (!docxCache[filePath]) {
        try {
          const r = await extractDocxImages(filePath, prefix);
          docxCache[filePath] = {
            imageUrls: r.imageUrls,
            allOcrTexts: r.screenshotOcrTexts.filter(t => t.trim().length > 0),
          };
        } catch (e: any) {
          console.error(`  Failed to process images from ${fileName}: ${e.message}`);
          docxCache[filePath] = { imageUrls: [], allOcrTexts: [] };
        }
      }
      const { imageUrls, allOcrTexts } = docxCache[filePath];
      if (imageUrls && imageUrls.length > 0) {
        doc.metadata.image_urls = imageUrls;
      }
      // Append all DOCX screenshot OCR texts to each DOCX document's text body.
      // Since SimpleDirectoryReader for DOCX doesn't expose page numbers (there's
      // just one document record), we inject every screenshot's OCR content into
      // the body so SentenceSplitter can include them in retrievable chunks.
      if (allOcrTexts.length > 0) {
        const existing = (doc as any).text || doc.getContent?.() || "";
        const merged = allOcrTexts.map((t, i) => `\n\n## OCR from embedded screenshot image ${i + 1} (DOCX paste)\n\n${t}`).join("\n");
        (doc as any).text = existing + merged;
      }
    }
  }

  // Manually split documents into chunks for retrieval.
  // Larger chunk size preserves structured content (Markdown tables, OCR blocks)
  // inside single nodes — a 10-row schedule table (~650 chars) fits in 1 chunk.
  const splitter = new SentenceSplitter({ chunkSize: 800, chunkOverlap: 80 });
  (splitter as any).tokenSize = (text: string) => Math.ceil(text.length / 4);
  const nodes = splitter.getNodesFromDocuments(documents);

  // Append image references to each node's text so the LLM can see them in retrieved context
  for (const node of nodes) {
    const imageUrls = node.metadata?.image_urls as string[] | undefined;
    if (imageUrls && imageUrls.length > 0) {
      const page = node.metadata?.page_number as number | undefined;
      const source = node.metadata?.file_name as string | undefined;
      const label = page
        ? `${source} page ${page}`
        : source || "document";
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
