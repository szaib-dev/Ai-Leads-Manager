import { trustedChatOrigin } from "@/lib/ai/request-origin";
import { getVerifiedUser } from "@/lib/auth/session";
import { databaseContext } from "@/lib/db/context";
import {
  chatRequestSchema,
  type ChatEvent,
  type ChatMessage,
} from "@/lib/ai/chat-contracts";
import { chatRpc } from "@/lib/ai/chat-db";
import { planAssistant } from "@/lib/ai/assistant-service";
import { responseMessages, streamResponse } from "@/lib/ai/response-stream";
import { aiServerToken, aiConfigured } from "@/lib/ai/config";
import type { AiResult } from "@/lib/ai/assistant-contracts";
import type { ProviderUsage } from "@/lib/ai/deepseek";
export const maxDuration = 120;
export async function POST(request: Request) {
  if (!trustedChatOrigin(request))
    return Response.json(
      { error: "Untrusted request origin" },
      { status: 403 },
    );
  if (!(await getVerifiedUser()))
    return Response.json(
      { error: "Please sign in again." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 500000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  let input;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 500000) throw new Error();
    input = chatRequestSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const { client } = await databaseContext();
  let claim: {
    state: string;
    attempt?: string;
    message?: ChatMessage;
    previousResult?: string;
  };
  try {
    claim = await chatRpc(client, "ai_chat_claim", {
      p_conversation: input.conversationId,
      p_user: input.userMessageId,
      p_assistant: input.assistantMessageId,
      p_content: input.text,
      p_scope: input.pageId,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not save message" },
      { status: 409 },
    );
  }
  if (claim.state === "busy")
    return Response.json(
      {
        error:
          "This conversation already has a request in progress. Wait for it to finish.",
      },
      { status: 409 },
    );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false,
        content = claim.message?.content ?? "",
        result: AiResult | undefined,
        usage: ProviderUsage | undefined,
        reserved = false;
      const budgetId = crypto.randomUUID();
      const emit = (event: ChatEvent) => {
        try {
          if (!closed)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      if (claim.state === "replay" && claim.message) {
        emit({ type: "replace", text: claim.message.content });
        emit({ type: "done", message: claim.message });
        controller.close();
        return;
      }
      try {
        emit({ type: "stage", text: "Checking workspace context…" });
        const memory = await chatRpc<{
          recent: { role: "user" | "assistant"; content: string }[];
          olderRelevant: unknown;
          previousResult?: string;
        }>(client, "ai_chat_context", {
          p_conversation: input.conversationId,
          p_before: input.assistantMessageId,
        });
        const planned = await planAssistant(
          input.text,
          {
            pageId: input.pageId ?? undefined,
            selectedIds: input.selectedIds,
            recentImportId: input.recentImportId,
            previousResultId: memory.previousResult ?? claim.previousResult,
            history: memory.recent.slice(-6).map((m) => ({
              role: m.role,
              content: m.content.slice(0, 1000),
            })),
          },
          input.assistantMessageId,
          {
            budgetId: claim.attempt,
            signal: request.signal,
            memory,
            stage: (text) => emit({ type: "stage", text }),
          },
        );
        if (planned.error) throw new Error(planned.error);
        result = planned.data?.result;
        if (result) emit({ type: "result", result });
        const evidence = result
          ? {
              action: result.action,
              status: result.status,
              count: result.count,
              requiresApproval: result.requiresApproval,
              scope: result.scope,
              summary: result.summary,
            }
          : { question: planned.data?.reply ?? "Please clarify your request." };
        const messages = responseMessages(input.text, evidence);
        request.signal.throwIfAborted();
        if (!aiConfigured()) throw new Error("DeepSeek is not configured.");
        const reserve = await client.rpc("ai_csv_reserve", {
          p_request: budgetId,
          p_input_bound: Buffer.byteLength(JSON.stringify(messages)) + 1024,
          p_server_token: aiServerToken(),
        });
        if (reserve.error) throw new Error(reserve.error.message);
        reserved = true;
        emit({ type: "stage", text: "Generating response…" });
        content = "";
        emit({ type: "replace", text: "" });
        const answer = await streamResponse(
          messages,
          (text) => {
            content += text;
            emit({ type: "delta", text });
          },
          request.signal,
        );
        usage = answer.usage;
        const saved = await chatRpc<boolean>(client, "ai_chat_finish", {
          p_id: input.assistantMessageId,
          p_attempt: claim.attempt,
          p_content: content,
          p_status: "completed",
          p_error: null,
          p_operation: result?.id ?? null,
          p_token: aiServerToken(),
        });
        if (saved)
          emit({
            type: "done",
            message: {
              id: input.assistantMessageId,
              role: "assistant",
              content,
              status: "completed",
              error: null,
              reply_to: input.userMessageId,
              operation_id: result?.id ?? null,
              created_at: new Date().toISOString(),
            },
          });
        else emit({ type: "redacted" });
      } catch (e) {
        if (e && typeof e === "object" && "usage" in e)
          usage = e.usage as ProviderUsage;
        const error =
          e instanceof Error ? e.message : "The response was interrupted.";
        try {
          const saved = await chatRpc<boolean>(client, "ai_chat_finish", {
            p_id: input.assistantMessageId,
            p_attempt: claim.attempt,
            p_content: content,
            p_status: request.signal.aborted ? "interrupted" : "failed",
            p_error: error.slice(0, 1000),
            p_operation: result?.id ?? null,
            p_token: aiConfigured() ? aiServerToken() : null,
          });
          if (!saved) {
            emit({ type: "redacted" });
          } else
            emit({
              type: "error",
              text:
                result?.status === "completed"
                  ? `The database action is confirmed. The response was interrupted: ${error}`
                  : error,
              operationId: result?.id,
            });
        } catch {
          emit({
            type: "error",
            text: "Could not save the final response. Reopen this conversation before retrying.",
            operationId: result?.id,
          });
        }
      } finally {
        if (reserved) {
          try {
            await client.rpc("ai_csv_settle", {
              p_request: budgetId,
              p_input: usage?.input ?? null,
              p_output: usage?.output ?? null,
              p_server_token: aiServerToken(),
            } as never);
          } catch {
            /* Conservative reservation remains held. */
          }
        }
        try {
          controller.close();
        } catch {}
        closed = true;
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
