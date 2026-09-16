import fs from "fs";
import path from "path";
import { createCanvas, Image } from "@napi-rs/canvas";
import { filterEmbeddedImage } from "./docx-extract";

const OUTPUT_DIR = "public/pdf-images";
const IMAGE_URL_PREFIX = "http://localhost:3001/pdf-images";
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;

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

function rawToPng(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const dst = imgData.data;

  if (channels === 4) {
    dst.set(data);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      dst[j] = data[i];
      dst[j + 1] = data[i + 1];
      dst[j + 2] = data[i + 2];
      dst[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      dst[j] = data[i];
      dst[j + 1] = data[i];
      dst[j + 2] = data[i];
      dst[j + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toBuffer("image/png");
}

interface TextItemPos {
  str: string;
  x: number; // PDF coordinate
  y: number; // PDF coordinate (from bottom)
  width: number;
  height: number;
}

/**
 * Group text items into lines by Y position, then find figure caption lines.
 * A caption line starts with "Figure N" or "Fig. N" — body text references
 * like "as shown in Figure 1" are NOT captions.
 */
interface LineInfo {
  y: number;
  text: string;
  height: number;
}

function buildLines(textItems: TextItemPos[]): LineInfo[] {
  const lines: LineInfo[] = [];
  const yTolerance = 3;

  for (const item of textItems) {
    const existing = lines.find((l) => Math.abs(l.y - item.y) < yTolerance);
    if (existing) {
      existing.text += item.str;
    } else {
      lines.push({ y: item.y, text: item.str, height: item.height });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/**
 * Find figure regions on a page by locating "Figure N:" caption lines.
 * Returns crop regions in viewport coordinates (scale applied).
 */
function findFigureRegions(
  textItems: TextItemPos[],
  pageWidth: number,
  pageHeight: number,
  scale: number
): { x: number; y: number; width: number; height: number }[] {
  const regions: { x: number; y: number; width: number; height: number }[] = [];
  const lines = buildLines(textItems);

  // Find lines that START with "Figure N" or "Fig. N" (actual captions, not body references)
  const captions = lines.filter((l) =>
    /^fig(?:ure)?\.?\s*\d/i.test(l.text.trim())
  );

  for (const caption of captions) {
    // The figure is typically ABOVE the caption.
    // Find the nearest text line above the caption (body text paragraph above figure)
    const captionY = caption.y;
    let aboveTextBottom = pageHeight; // default: top of page

    for (const l of lines) {
      // Find a line above the caption (higher Y in PDF coords) with substantial text
      if (l.y > captionY + 5 && l.y < aboveTextBottom && l.text.trim().length > 20) {
        aboveTextBottom = l.y;
      }
    }

    // Crop region in PDF coords: from aboveTextBottom to captionY + caption.height
    const cropTopPdf = Math.min(aboveTextBottom, pageHeight);
    const cropBottomPdf = Math.max(captionY - caption.height, 0);

    // Convert to viewport coordinates (canvas coords with scale)
    // PDF Y is from bottom, canvas Y is from top
    const canvasY = (pageHeight - cropTopPdf) * scale;
    const canvasBottom = (pageHeight - cropBottomPdf) * scale;
    const canvasHeight = canvasBottom - canvasY;

    if (canvasHeight > 50 * scale) {
      regions.push({
        x: 0,
        y: Math.max(0, canvasY),
        width: pageWidth * scale,
        height: canvasHeight,
      });
    }
  }

  return regions;
}

/**
 * Extract images from a PDF using a hybrid strategy:
 * 1. Extract embedded raster images (photos, illustrations stored as JPEG/PNG)
 *    — skipping any page whose textContent is known to be empty (scanned page,
 *      its embedded raster is the whole-page image, not a reusable figure).
 * 2. For pages that mention "Figure"/"Fig." in text but have no embedded
 *    raster images, crop the figure region from a rendered page.
 */
export async function extractPdfImages(
  pdfPath: string,
  namePrefix: string,
  options?: { emptyPageNumbers?: number[] }
): Promise<Record<number, string[]>> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const emptyPages = new Set(options?.emptyPageNumbers ?? []);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await getDocumentProxy(data, {
    canvasFactory: canvasFactory as any,
  });

  const { OPS } = await getResolvedPDFJS();
  const pageImageMap: Record<number, string[]> = {};

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    let urls: string[] = [];
    let imgIdx = 0;

    // --- Strategy 1: Extract embedded raster images ---
    const viewport = page.getViewport({ scale: 1 });
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    const renderCanvas = createCanvas(w, h);
    const renderCtx = renderCanvas.getContext("2d");
    try {
      await page.render({
        canvasContext: renderCtx,
        viewport,
        canvasFactory: canvasFactory as any,
      } as any).promise;
    } catch {
      // ignore
    }

    let operatorList;
    try {
      operatorList = await page.getOperatorList();
    } catch {
      operatorList = null;
    }

    if (operatorList) {
      for (let j = 0; j < operatorList.fnArray.length; j++) {
        if (operatorList.fnArray[j] !== OPS.paintImageXObject) continue;

        // On a page that SimpleDirectoryReader returned empty text (i.e. a
        // scanned/image-only page), any embedded raster image is almost
        // certainly the whole-page scan raster, not an actual figure — skip.
        if (emptyPages.has(i)) {
          continue;
        }

        const key = operatorList.argsArray[j][0];

        let image: any;
        try {
          image = page.objs.get(key);
        } catch {
          continue;
        }
        if (!image?.data || !image?.width || !image?.height) continue;

        const { width, height, data: imgData } = image;
        if (width < MIN_WIDTH || height < MIN_HEIGHT) continue;
        const channels = imgData.length / (width * height);
        if (![1, 3, 4].includes(channels)) continue;

        imgIdx++;
        const buf = rawToPng(imgData, width, height, channels);

        // Filter out screenshots / tiny icons using the same pixel analyzer
        const filter = filterEmbeddedImage(buf);
        if (!filter.keep) {
          console.log(
            `  Embedded skip page ${i} #${imgIdx + 0} (${width}x${height}, category=${filter.category}): ${filter.reason}`
          );
          imgIdx--;
          continue;
        }

        const fileName = `${namePrefix}_page_${i}_fig_${imgIdx}.png`;
        fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buf);
        urls.push(`${IMAGE_URL_PREFIX}/${fileName}`);
        console.log(
          `  Embedded: ${fileName} (${width}x${height}, ${(buf.length / 1024).toFixed(0)} KB)`
        );
      }
    }

    // --- Strategy 2: Crop figure regions for pages with figure captions ---
    if (urls.length === 0) {
      let textItems: TextItemPos[] = [];
      try {
        const textContent = await page.getTextContent();
        textItems = textContent.items.map((item: any) => ({
          str: item.str || "",
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
          height: item.height || 0,
        }));
      } catch {
        // ignore
      }

      const hasFigureCaption = textItems.length > 0 &&
        buildLines(textItems).some((l) => /^fig(?:ure)?\.?\s*\d/i.test(l.text.trim()));
      if (hasFigureCaption) {
        const scale = 2;
        const hiViewport = page.getViewport({ scale });
        const hw = Math.floor(hiViewport.width);
        const hh = Math.floor(hiViewport.height);
        const figCanvas = createCanvas(hw, hh);
        const figCtx = figCanvas.getContext("2d");
        try {
          await page.render({
            canvasContext: figCtx,
            viewport: hiViewport,
            canvasFactory: canvasFactory as any,
          } as any).promise;
        } catch {
          // ignore
        }

        // Find figure regions and crop
        const regions = findFigureRegions(
          textItems,
          page.getViewport({ scale: 1 }).width,
          page.getViewport({ scale: 1 }).height,
          scale
        );

        if (regions.length > 0) {
          for (let r = 0; r < regions.length; r++) {
            const region = regions[r];
            const cropW = Math.floor(region.width);
            const cropH = Math.floor(region.height);
            if (cropW < 100 || cropH < 100) continue;

            const cropped = createCanvas(cropW, cropH);
            const cropCtx = cropped.getContext("2d");
            cropCtx.drawImage(figCanvas, region.x, region.y, cropW, cropH, 0, 0, cropW, cropH);

            imgIdx++;
            const buf = cropped.toBuffer("image/png");
            const fileName = `${namePrefix}_page_${i}_fig_${imgIdx}.png`;
            fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buf);
            urls.push(`${IMAGE_URL_PREFIX}/${fileName}`);
            console.log(
              `  Figure crop: ${fileName} (${cropW}x${cropH}, ${(buf.length / 1024).toFixed(0)} KB)`
            );
          }
        } else {
          // Fallback: save full page render
          imgIdx++;
          const buf = figCanvas.toBuffer("image/png");
          const fileName = `${namePrefix}_page_${i}_fig_${imgIdx}.png`;
          fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buf);
          urls.push(`${IMAGE_URL_PREFIX}/${fileName}`);
          console.log(
            `  Page render: ${fileName} (${hw}x${hh}, ${(buf.length / 1024).toFixed(0)} KB)`
          );
        }
      }
    }

    if (urls.length > 0) {
      pageImageMap[i] = urls;
    }
  }

  await pdf.destroy();
  return pageImageMap;
}
