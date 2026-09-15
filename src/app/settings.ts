import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "llamaindex";

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
}
