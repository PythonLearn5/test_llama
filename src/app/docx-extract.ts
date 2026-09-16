import fs from "fs";
import path from "path";
import { createCanvas, Image } from "@napi-rs/canvas";
import { htmlTableToMarkdown } from "./html-table";

const OUTPUT_DIR = "public/pdf-images";
const IMAGE_URL_PREFIX = "http://localhost:3001/pdf-images";

export interface FilterResult {
  keep: boolean;
  category: "illustration" | "screenshot" | "icon" | "blank";
  reason: string;
  width: number;
  height: number;
  ratio: number;
}

/**
 * ImageFilter analyzes an embedded image's pixel data and aspect ratio
 * to categorize it:
 *   - "illustration": kept as an inlined image (photos, charts, diagrams)
 *   - "screenshot"  : full-page document paste — NOT saved as image,
 *                     but sent through OCR later so its text is indexed
 *   - "icon"        : tiny bullets / stamps, skipped entirely
 *   - "blank"       : nearly empty page / watermark, skipped entirely
 */
export function filterEmbeddedImage(buffer: Buffer): FilterResult {
  const img = new Image();
  img.src = buffer;
  const w = img.width || 0;
  const h = img.height || 0;
  const ratio = w && h ? w / h : 0;

  if (w < 150 || h < 150) {
    return { keep: false, category: "icon", reason: "尺寸过小(<150px，图标/印章类)", width: w, height: h, ratio };
  }

  // Down-sample for pixel analysis (max 320px wide) for speed
  const sw = Math.min(w, 320);
  const sh = Math.round(h * (sw / w));
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  let whiteLike = 0;
  let colorful = 0;
  let dark = 0;
  const total = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const avg = (r + g + b) / 3;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (avg > 240 && max - min < 20) whiteLike++;
    else if (avg < 90) dark++;
    if (max - min > 30) colorful++;
  }
  const whiteR = whiteLike / total;
  const colorR = colorful / total;
  const darkR = dark / total;
  const reasonTail = `白${(whiteR*100).toFixed(0)}% 彩${(colorR*100).toFixed(0)}% 暗${(darkR*100).toFixed(0)}%`;

  const mostlyWhiteBg = whiteR > 0.70;
  const lowColor = colorR < 0.12;

  // Full-page document screenshot detection
  const nearDocRatio = (ratio >= 0.65 && ratio <= 0.82) || (ratio >= 1.22 && ratio <= 1.54);
  const largePortrait = h >= 900 && w >= 600;
  if ((nearDocRatio || largePortrait) && mostlyWhiteBg && lowColor) {
    return { keep: false, category: "screenshot", reason: `整页文档截图(${reasonTail})`, width: w, height: h, ratio };
  }

  // Blank or near-blank (seal only, watermark)
  if (mostlyWhiteBg && darkR < 0.02 && lowColor) {
    return { keep: false, category: "blank", reason: `几乎空白(${reasonTail})`, width: w, height: h, ratio };
  }

  return { keep: true, category: "illustration", reason: `插图类(${reasonTail})`, width: w, height: h, ratio };
}

export interface ExtractedDocxResult {
  imageUrls: string[];
  screenshotBuffers: { idx: number; buffer: Buffer; contentType: string }[];
  screenshotOcrTexts: string[];
}

/**
 * Extract embedded images from a DOCX file.
 *
 * - "illustration" images are saved to disk and returned as image URLs.
 * - "screenshot" images are NOT saved as figures, but their raw buffers are
 *   returned so the caller can run them through OCR (MinerU) and inject the
 *   text back into the document chunks for indexing.
 * - "icon" / "blank" images are fully ignored.
 *
 * Also runs OCR inline when screenshotBuffers are populated, via the same
 * MinerU service used for image-based PDFs.
 */
export async function extractDocxImages(
  docxPath: string,
  namePrefix: string
): Promise<ExtractedDocxResult> {
  const mammoth = await import("mammoth");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const imageUrls: string[] = [];
  const screenshotBuffers: { idx: number; buffer: Buffer; contentType: string }[] = [];
  const basename = path.basename(docxPath);

  let orderIdx = 0;
  let keptIdx = 0;

  const options = {
    convertImage: mammoth.images.imgElement(async (image: any) => {
      const buffer = Buffer.from(await image.read());
      orderIdx++;
      const contentType: string = image.contentType || "image/png";
      const ext = contentType.split("/")[1] || "png";
      const filter = filterEmbeddedImage(buffer);

      if (filter.category === "icon" || filter.category === "blank") {
        console.log(
          `  DOCX #${orderIdx} (${filter.width}×${filter.height}, ${(buffer.length/1024|0)}KB): 丢弃 — ${filter.reason}`
        );
        return { src: "" };
      }

      if (filter.category === "screenshot") {
        screenshotBuffers.push({ idx: orderIdx, buffer, contentType });
        console.log(
          `  DOCX #${orderIdx} (${filter.width}×${filter.height}): 暂存为待OCR截图 — ${filter.reason}`
        );
        // Return empty src; the OCR text will be appended by generate.ts
        return { src: "" };
      }

      keptIdx++;
      const fileName = `${namePrefix}_img_${keptIdx}.${ext}`;
      const filePath = path.join(OUTPUT_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      const url = `${IMAGE_URL_PREFIX}/${fileName}`;
      imageUrls.push(url);
      console.log(
        `  DOCX img: ${fileName} (${filter.width}×${filter.height}) — 保留插图 (${filter.reason})`
      );
      return { src: url };
    }),
  };

  try {
    await mammoth.convertToHtml({ path: docxPath }, options);
  } catch (e: any) {
    console.error(`  Failed convertToHtml for ${basename}: ${e.message}`);
  }

  // --- Run OCR on every screenshot image, using MinerU's image-file endpoint ---
  const screenshotOcrTexts: string[] = [];
  if (screenshotBuffers.length > 0) {
    const mineruUrl = process.env.MINERU_URL || "http://192.168.15.110:8000";
    console.log(
      `  DOCX ${basename}: 检测到 ${screenshotBuffers.length} 张整页截图，调用 MinerU 进行 OCR ...`
    );
    for (const entry of screenshotBuffers) {
      const ext = entry.contentType.split("/")[1] || "png";
      const formData = new FormData();
      const blob = new Blob([entry.buffer], { type: entry.contentType });
      formData.append("files", blob, `docx_screenshot_${entry.idx}.${ext}`);
      formData.append("parse_method", "ocr");
      formData.append("backend", "pipeline");
      formData.append("lang_list", "ch");
      formData.append("return_md", "true");

      try {
        const res = await fetch(mineruUrl + "/file_parse", {
          method: "POST",
          body: formData,
        });
        if (res.status !== 200) {
          const txt = await res.text();
          console.error(`    MinerU OCR screenshot #${entry.idx} HTTP ${res.status}: ${txt.slice(0, 200)}`);
          screenshotOcrTexts.push("");
          continue;
        }
        const json = await res.json();
        const firstFile = Object.keys(json.results || {})[0];
        const md = firstFile ? (json.results[firstFile].md_content || "") : "";
        screenshotOcrTexts.push(htmlTableToMarkdown(md));
        console.log(
          `    Screenshot #${entry.idx}: OCR ${md.length} chars`
        );
      } catch (e: any) {
        console.error(`    MinerU OCR screenshot #${entry.idx} error: ${e.message}`);
        screenshotOcrTexts.push("");
      }
    }
  }

  console.log(
    `  DOCX ${basename}: 保留插图 ${imageUrls.length} 张；截图类图片 OCR ${screenshotOcrTexts.filter(t => t.length>0).length}/${screenshotBuffers.length} 张`
  );
  return { imageUrls, screenshotBuffers, screenshotOcrTexts };
}
