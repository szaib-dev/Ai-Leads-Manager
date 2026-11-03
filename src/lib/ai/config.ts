import "server-only";
import { createHmac } from "node:crypto";
export const MODEL = "deepseek-flash";
export const OUTPUT_TOKENS = 512;
export function aiServerToken() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key)
    throw new Error(
      "Set DEEPSEEK_API_KEY on the server to enable CSV assistance.",
    );
  return createHmac("sha256", key).update("folio-ai-server-v1").digest("hex");
}

export function aiConfigured() {
  return !!process.env.DEEPSEEK_API_KEY;
}
