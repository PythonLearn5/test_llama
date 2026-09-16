import fs from "fs";
import path from "path";
import { htmlTableToMarkdown } from "./html-table";

const DEFAULT_SERVER_URL = "http://192.168.15.110:8000";
const IMAGE_DIR = "public/pdf-images";
const IMAGE_URL_PREFIX = "http://localhost:3001/pdf-images";

export interface MineruPageResult {
  pageNumber: number;
  text: string;
  imageUrls: string[];
}

export interface MineruPdfResult {
  pages: MineruPageResult[];
}

/**
 * Upload a PDF to the local MinerU service for parsing (OCR).
 *
 * Returns Markdown content with image references replaced to local URLs,
 * and a list of page splits for assigning metadata in generate.ts.
 *
 * MinerU is used only when the default PDFReader returns empty text
 * for a page (i.e. image-based / scanned PDF).
 */
export async function mineruParsePdf(
  pdfPath: string,
  namePrefix: string,
  options?: {
    serverUrl?: string;
    langList?: string;
  }
): Promise<MineruPdfResult> {
  const serverUrl = options?.serverUrl ?? process.env.MINERU_URL ?? DEFAULT_SERVER_URL;
  const langList = options?.langList ?? "ch";

  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  const originalName = path.basename(pdfPath);

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  formData.append("files", blob, originalName);
  formData.append("parse_method", "ocr");
  formData.append("backend", "pipeline");
  formData.append("lang_list", langList);
  formData.append("return_md", "true");
  formData.append("return_images", "true");
  formData.append("return_content_list", "true");
  formData.append("table_enable", "true");
  formData.append("formula_enable", "true");

  console.log(`  MinerU uploading ${originalName}...`);
  const res = await fetch(serverUrl + "/file_parse", {
    method: "POST",
    body: formData,
  });
  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`MinerU HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  const result = json.results?.[originalName] ?? json.results?.[originalName.replace(/\.pdf$/i, "")];
  if (!result) {
    const available = Object.keys(json.results || {});
    throw new Error(`MinerU returned no results for ${originalName}. Available: ${available.join(", ")}`);
  }

  // --- Step 1: Save images and build a replacement map ---
  const mineruImages: Record<string, string> = result.images || {};
  const savedUrls: Record<string, string> = {};
  let imgCounter = 0;

  const imageEntries = Object.entries(mineruImages);
  for (const [relPath, base64] of imageEntries) {
    // MinerU may return either base64 string or a data URI
    let data: string = base64;
    const m = data.match(/^data:([^;]+);base64,(.*)$/s);
    let ext = "jpg";
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime.includes("png")) ext = "png";
      else if (mime.includes("jpeg") || mime.includes("jpg")) ext = "jpg";
      else if (mime.includes("gif")) ext = "gif";
      else if (mime.includes("webp")) ext = "webp";
      data = m[2];
    } else {
      // pure base64, try detect by rel path ext
      const relExt = path.extname(relPath).toLowerCase().replace(".", "");
      if (relExt) ext = relExt || "jpg";
    }

    imgCounter++;
    const fileName = `${namePrefix}_fig_${imgCounter}.${ext}`;
    const filePath = path.join(IMAGE_DIR, fileName);
    try {
      fs.writeFileSync(filePath, Buffer.from(data, "base64"));
    } catch (e: any) {
      console.error(`  Failed to save image ${fileName}: ${e.message}`);
      continue;
    }
    const url = `${IMAGE_URL_PREFIX}/${fileName}`;
    savedUrls[relPath] = url;
    savedUrls[`images/${path.basename(relPath)}`] = url;
  }
  if (imgCounter > 0) {
    console.log(`  MinerU saved ${imgCounter} images`);
  }

  // --- Step 2: Fix encoding + replace image paths in MD ---
  let mdContent: string = result.md_content || "";

  // Replace image references like ![alt](images/xxx.jpg) with local URL
  for (const [relPath, localUrl] of Object.entries(savedUrls)) {
    // Match both exact and images/ prefixed paths
    const patterns = [
      new RegExp(`\\(([^)]*?)${escapeReg(path.basename(relPath))}\\)`, "g"),
      new RegExp(`\\(([^)]*?)${escapeReg(relPath)}\\)`, "g"),
    ];
    for (const re of patterns) {
      mdContent = mdContent.replace(re, `(${localUrl})`);
    }
  }

  // --- Step 2.5: Convert all HTML <table> blocks to Markdown tables.
  // MinerU's raw HTML tables contain verbose rowspan/colspan attributes that
  // confuse SentenceSplitter and the LLM. Pure Markdown tables preserve the data
  // with ~1/10th the token count, and the UI renders them natively.
  mdContent = htmlTableToMarkdown(mdContent);

  // --- Step 3: Split MD into pages (MinerU may not give explicit page splits,
  // so we split by major headings and distribute evenly. Since we're called
  // only for scanned PDFs that had empty pages, we just return 1 "page" of
  // content and distribute images across all of them on the caller side if needed ---
  const pages: MineruPageResult[] = [];

  // Find all image URLs referenced in the full md
  const allImages = Array.from(new Set(
    Array.from(mdContent.matchAll(/\((https?:\/\/[^)]+\.(?:png|jpg|jpeg|gif|webp|bmp))\)/gi))
      .map((m) => m[1])
  ));

  // We split MinerU output by page-level markers when available.
  // MinerU uses markdown, so we heuristically split on `#` headings
  // but keep it simple: return a single result with the full MD, and let
  // the caller map it across however many PDFReader pages exist.
  pages.push({
    pageNumber: 0, // caller will reassign based on actual PDF pages
    text: mdContent,
    imageUrls: allImages,
  });

  return { pages };
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
