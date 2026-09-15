import { LlamaIndexServer } from "@llamaindex/server";
import http from "http";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { initSettings } from "./app/settings";
import { workflowFactory } from "./app/workflow";

initSettings();

// Start a lightweight static file server for PDF images on port 3001
const IMAGE_DIR = "public/pdf-images";
http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url || "");
    // Only allow PNG files from the pdf-images directory
    if (!url.startsWith("/pdf-images/") || !url.endsWith(".png")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const fileName = path.basename(url);
    const filePath = path.join(IMAGE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(buf);
  })
  .listen(3001, () => {
    console.log("> Image server listening at http://localhost:3001");
  });

new LlamaIndexServer({
  workflow: workflowFactory,
  uiConfig: {
    componentsDir: "components",
    devMode: true,
  },
}).start();
