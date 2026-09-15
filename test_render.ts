import fs from "fs";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";

// Canvas factory for Node.js
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(context: any, width: number, height: number) {
    context.canvas.width = width;
    context.canvas.height = height;
  }
  destroy(context: any) {
    context.canvas.width = 0;
    context.canvas.height = 0;
  }
}

const canvasFactory = new NodeCanvasFactory();

async function renderPdfPages(pdfPath: string, outputDir: string, namePrefix: string) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, canvasFactory: canvasFactory as any }).promise;

  console.log(`PDF: ${path.basename(pdfPath)}, ${doc.numPages} pages`);

  const imageUrls: { page: number; url: string }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory: canvasFactory as any,
    } as any).promise;

    const fileName = `${namePrefix}_page_${i}.png`;
    const filePath = path.join(outputDir, fileName);
    const buf = canvas.toBuffer("image/png");
    fs.writeFileSync(filePath, buf);

    const url = `/pdf-images/${fileName}`;
    imageUrls.push({ page: i, url });
    console.log(`  Page ${i} -> ${fileName} (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  await doc.destroy();
  return imageUrls;
}

async function main() {
  const outputDir = "public/pdf-images";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const pdfs = [
    { path: "data/101.pdf", prefix: "101" },
    { path: "data/attention is all you need.pdf", prefix: "attention" },
  ];

  for (const pdf of pdfs) {
    console.log(`\nProcessing: ${pdf.path}`);
    try {
      await renderPdfPages(pdf.path, outputDir, pdf.prefix);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }
}

main();
