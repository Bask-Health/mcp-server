import OpenAI from "openai";
import { config } from "./config.js";

// Initialize OpenAI client with error handling
let openaiClient: OpenAI | null = null;

try {
  openaiClient = new OpenAI({
    apiKey: config.openai.apiKey,
  });
} catch (error) {
  console.error("Failed to initialize OpenAI client:", error);
}

export { openaiClient };

export const VECTOR_STORE_ID = config.openai.vectorStoreId;

export function validateOpenAIClient(): OpenAI {
  if (!openaiClient) {
    throw new Error(
      "OpenAI client not initialized - check API key configuration"
    );
  }
  return openaiClient;
}
