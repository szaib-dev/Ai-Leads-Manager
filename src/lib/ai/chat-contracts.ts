import { z } from "zod";
import type { AiResult } from "./assistant-contracts";
export interface Conversation {
  id: string;
  title: string;
  scope_page_id: string | null;
  updated_at: string;
}
export interface ChatMessage {
  artifact?: ImportArtifact | null;
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "completed" | "processing" | "failed" | "interrupted" | "redacted";
  error: string | null;
  reply_to: string | null;
  operation_id: string | null;
  created_at: string;
}
export const importArtifactSchema = z
  .object({
    kind: z.literal("import"),
    importId: z.uuid(),
    pageId: z.uuid(),
    fileName: z.string().max(255),
    imported: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    status: z.string().max(30),
  })
  .strict();
export type ImportArtifact = z.infer<typeof importArtifactSchema>;
export interface Thread {
  conversation: Conversation;
  messages: ChatMessage[];
  hasMore: boolean;
  results: Record<string, AiResult>;
}
export const chatRequestSchema = z
  .object({
    conversationId: z.uuid(),
    userMessageId: z.uuid(),
    assistantMessageId: z.uuid(),
    text: z.string().trim().min(1).max(4000),
    pageId: z.uuid().nullable(),
    selectedIds: z.array(z.uuid()).max(10000).default([]),
    recentImportId: z.uuid().optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatEvent =
  | { type: "stage"; text: string }
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "result"; result: AiResult }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; text: string; operationId?: string }
  | { type: "redacted" };
export function shouldSend(text: string, busy: boolean, isComposing = false) {
  return !busy && !isComposing && text.trim().length > 0;
}
export function composerIntent(
  key: string,
  shift: boolean,
  isComposing: boolean,
) {
  return key === "Enter" && !shift && !isComposing ? "send" : "edit";
}
