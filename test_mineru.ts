import fs from "fs";
import "dotenv/config";
import { mineruParsePdf } from "./src/app/mineru-client";

async function main() {
  const pdfPath = "data/Diagnostic_Training_Assessment_Notice.pdf";
  const fileName = "Diagnostic_Training_Assessment_Notice";
  const prefix = fileName.replace(/\.pdf$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

  console.log(`Parsing ${pdfPath} via MinerU...`);
  const result = await mineruParsePdf(pdfPath, prefix);

  const md = result.pages[0];

  console.log("\n========================================");
  console.log("MinerU 识别结果");
  console.log("========================================");
  console.log(`\n总字符数:`, md.text.length);
  console.log(`图片数量:`, md.imageUrls.length);
  console.log(`\n图片列表:`);
  md.imageUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));

  console.log("\n========================================");
  console.log("Markdown 内容（完整输出：");
  console.log("========================================");
  process.stdout.write(Buffer.from(md.text, "utf-8"));
  process.stdout.write("\n--- END ---\n");

  // Save to file for easier reading
  const outFile = "output/mineru_output.md";
  if (!fs.existsSync("output")) fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(md.text, "utf-8"));
  console.log(`\nMarkdown 已保存到 ${outFile}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
