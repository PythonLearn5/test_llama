import fs from "fs";
import "dotenv/config";
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { initSettings } from "./src/app/settings";
import { mineruParsePdf } from "./src/app/mineru-client";

async function main() {
  const fileName = "Diagnostic_Training_Assessment_Notice.pdf";
  const pdfPath = `data/${fileName}`;
  const prefix = "diagnostic_training_assessment_notice";

  if (!fs.existsSync("output")) fs.mkdirSync("output", { recursive: true });

  console.log(`\n========== 步骤 1：SimpleDirectoryReader 原始提取 ==========`);
  initSettings();
  const reader = new SimpleDirectoryReader();
  const docs = await reader.loadData("data");
  const noticeDocs = docs.filter((d: any) => d.metadata?.file_name === fileName);
  console.log(`PDFReader 文档页数: ${noticeDocs.length}`);
  for (let i = 0; i < noticeDocs.length; i++) {
    const doc = noticeDocs[i] as any;
    const text = (doc.text || doc.getContent?.() || "").trim();
    const pn = doc.metadata?.page_number;
    console.log(`  Page ${pn}: 文本长度 = ${text.length} 字符`);
    if (text.length === 0) console.log(`    ⚠ 纯图片页，PDFReader 取不到文本`);
    else console.log(`    前 200 字符: ${text.slice(0, 200)}`);
  }

  console.log(`\n========== 步骤 2：MinerU OCR 解析 ==========`);
  const r = await mineruParsePdf(pdfPath, prefix);
  const md = r.pages[0]?.text || "";
  const imgs = r.pages[0]?.imageUrls || [];
  console.log(`MinerU 返回: ${md.length} 字符，${imgs.length} 张图片`);

  console.log(`\n========== 步骤 3：图片 URL ==========`);
  imgs.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  const mdOut = "output/diagnostic_mineru.md";
  fs.writeFileSync(mdOut, Buffer.from(md, "utf-8"));
  console.log(`\n========== 步骤 4：Markdown 内容已保存到 ${mdOut} ==========`);

  console.log(`\n========== 步骤 5：内容摘要（关键词校验）==========`);
  const keywords = ["培训", "时间", "地点", "上海", "2023", "6月", "费用", "报名", "付款", "联系方式"];
  for (const kw of keywords) {
    const found = md.includes(kw);
    console.log(`  关键词「${kw}」: ${found ? "✅ 已提取" : "❌ 缺失"}`);
  }

  console.log(`\n========== 步骤 6：Markdown 结构片段（前 4000 字符）==========`);
  process.stdout.write(Buffer.from(md.slice(0, 4000), "utf-8"));
  process.stdout.write("\n\n--- preview end ---\n");
}

main().catch((e) => {
  console.error("测试失败：", e);
  process.exit(1);
});
