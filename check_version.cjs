const fs = require("fs");
const path = require("path");

// Check nested pdfjs-dist under react-pdf
const nestedPath = "node_modules/@llamaindex/server/node_modules/@llamaindex/chat-ui/node_modules/@llamaindex/pdf-viewer/node_modules/react-pdf/node_modules/pdfjs-dist";
const altPath = "node_modules/@llamaindex/chat-ui/node_modules/@llamaindex/pdf-viewer/node_modules/react-pdf/node_modules/pdfjs-dist";

let pkgPath = null;
for (const p of [nestedPath, altPath]) {
  if (fs.existsSync(path.join(p, "package.json"))) {
    pkgPath = p;
    break;
  }
}

if (pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgPath, "package.json"), "utf8"));
  console.log("Nested pdfjs-dist version:", pkg.version);
  
  // Check worker version
  const workerFile = path.join(pkgPath, "legacy/build/pdf.worker.mjs");
  if (fs.existsSync(workerFile)) {
    const w = fs.readFileSync(workerFile, "utf8");
    const m = w.match(/PDFWorkerVersion\s*=\s*["']([^"']+)["']/);
    console.log("Nested worker version:", m ? m[1] : "not found");
  }
} else {
  console.log("No nested pdfjs-dist found, checking npm dedupe...");
  // List all pdfjs-dist directories
  const { execSync } = require("child_process");
  const out = execSync("npm ls pdfjs-dist --all 2>&1", { encoding: "utf8" });
  console.log(out);
}

// Also check top-level worker
const topWorker = "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";
if (fs.existsSync(topWorker)) {
  const w = fs.readFileSync(topWorker, "utf8");
  const m = w.match(/PDFWorkerVersion\s*=\s*["']([^"']+)["']/);
  console.log("Top-level worker version:", m ? m[1] : "not found");
  
  // Also search for version string
  const m2 = w.match(/workerVersion\s*[:=]\s*["']([^"']+)["']/i);
  console.log("Top-level worker version (alt):", m2 ? m2[1] : "not found");
}
