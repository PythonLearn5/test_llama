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
  // Use smaller chunks so each node focuses on a single topic for better retrieval
  // Provide a simple tokenSize function (~4 chars ≈ 1 token) since no tokenizer is installed
  Settings.nodeParser = new SentenceSplitter({
    chunkSize: 256,
    chunkOverlap: 20,
  });
  (Settings.nodeParser as any).tokenSize = (text: string) => Math.ceil(text.length / 4);
}
