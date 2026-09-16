import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { SentenceSplitter, Settings } from "llamaindex";

export function initSettings() {
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseURL = process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1";

  Settings.llm = new OpenAI({
    model: process.env.MODEL ?? "openai/gpt-4o-mini",
    apiKey,
    baseURL,
    maxTokens: process.env.LLM_MAX_TOKENS
      ? Number(process.env.LLM_MAX_TOKENS)
      : undefined,
  });
  Settings.embedModel = new OpenAIEmbedding({
    model: process.env.EMBEDDING_MODEL,
    apiKey,
    baseURL,
    dimensions: process.env.EMBEDDING_DIM
      ? parseInt(process.env.EMBEDDING_DIM)
      : undefined,
  });
  // Larger chunk size to keep structured content (Markdown tables, OCR blocks)
  // intact within a single vector node. 800 chars (~200 tokens) is enough for
  // most 10-row tables and figure captions. overlap is large enough that
  // split tables still share rows between consecutive chunks.
  Settings.nodeParser = new SentenceSplitter({
    chunkSize: 800,
    chunkOverlap: 80,
  });
  (Settings.nodeParser as any).tokenSize = (text: string) => Math.ceil(text.length / 4);
}
