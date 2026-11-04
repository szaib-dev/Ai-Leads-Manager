"use server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { databaseContext } from "@/lib/db/context";
import { message } from "./assistant-service";
import { aiServerToken } from "./config";
import { chatRpc } from "./chat-db";
import {
  confirmAiPlan,
  cancelAiPlan,
  aiResultPage,
  reviewAiUndo,
} from "./assistant-actions";
import type { ActionResult } from "@/lib/leads/contracts";
import type { Conversation, ChatMessage, Thread } from "./chat-contracts";
import type { AiResult } from "./assistant-contracts";
export async function conversations(
  before?: string,
): Promise<ActionResult<{ rows: Conversation[]; more: boolean }>> {
  try {
    const { client, user } = await databaseContext();
    let q = client
      .from("ai_conversations")
      .select("id,title,scope_page_id,updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(31);
    if (before)
      q = q.lt("updated_at", z.iso.datetime({ offset: true }).parse(before));
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    const rows = r.data as unknown as Conversation[];
    return { data: { rows: rows.slice(0, 30), more: rows.length > 30 } };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function conversationThread(
  id: string,
  before?: string,
): Promise<ActionResult<Thread>> {
  try {
    const { client, user } = await databaseContext();
    id = z.uuid().parse(id);
    const c = await client
      .from("ai_conversations")
      .select("id,title,scope_page_id,updated_at")
      .eq("owner_id", user.id)
      .eq("id", id)
      .maybeSingle();
    if (c.error || !c.data) throw new Error("Conversation unavailable");
    let q = client
      .from("ai_chat_messages")
      .select("id,role,content,status,error,reply_to,operation_id,created_at")
      .eq("owner_id", user.id)
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(41);
    if (before)
      q = q.lt("created_at", z.iso.datetime({ offset: true }).parse(before));
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data as unknown as ChatMessage[]).slice(0, 40).reverse();
    // Include a failed response's parent when a history page cuts between the pair.
    const parentId = rows[0]?.role === "assistant" ? rows[0].reply_to : null;
    if (parentId && !rows.some((m) => m.id === parentId)) {
      const parent = await client
        .from("ai_chat_messages")
        .select("id,role,content,status,error,reply_to,operation_id,created_at")
        .eq("owner_id", user.id)
        .eq("conversation_id", id)
        .eq("id", parentId)
        .maybeSingle();
      if (parent.data) rows.unshift(parent.data as ChatMessage);
    }
    const ids = [
      ...new Set(rows.flatMap((m) => (m.operation_id ? [m.operation_id] : []))),
    ].slice(-8);
    const results: Record<string, AiResult> = {};
    const loaded = await Promise.allSettled(
      ids.map(async (op) => ({ id: op, result: await aiResultPage(op, 1) })),
    );
    for (const item of loaded)
      if (item.status === "fulfilled" && item.value.result.data)
        results[item.value.id] = item.value.result.data;
    return {
      data: {
        conversation: c.data as unknown as Conversation,
        messages: rows,
        hasMore: (r.data?.length ?? 0) > 40,
        results,
      },
    };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function chatOperation(input: {
  conversationId: string;
  operationId: string;
  action: "confirm" | "cancel" | "undo" | "page";
  page?: number;
}): Promise<ActionResult<AiResult | true>> {
  try {
    const p = z
      .object({
        conversationId: z.uuid(),
        operationId: z.uuid(),
        action: z.enum(["confirm", "cancel", "undo", "page"]),
        page: z.number().int().min(1).max(501).optional(),
      })
      .strict()
      .parse(input);
    const { client, user } = await databaseContext();
    const associated = await client
      .from("ai_chat_messages")
      .select("id")
      .eq("owner_id", user.id)
      .eq("conversation_id", p.conversationId)
      .eq("operation_id", p.operationId)
      .limit(1);
    if (associated.error || !associated.data?.length)
      throw new Error("This operation does not belong to the conversation.");
    if (p.action === "page") return aiResultPage(p.operationId, p.page ?? 1);
    if (p.action === "cancel") {
      const r = await cancelAiPlan(p.operationId);
      if (r.error) throw new Error(r.error);
      await chatRpc(client, "ai_chat_event", {
        p_conversation: p.conversationId,
        p_operation: p.operationId,
        p_content: "Plan cancelled. No changes were applied.",
        p_token: aiServerToken(),
      });
      return { data: true };
    }
    // Retrying a lost undo response must resolve the same plan, including Autonomous mode.
    const hash = createHash("sha256")
      .update(`chat-undo:${p.conversationId}:${p.operationId}`)
      .digest("hex");
    const undoRequest = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const r =
      p.action === "undo"
        ? await reviewAiUndo(p.operationId, undoRequest)
        : await confirmAiPlan(p.operationId);
    if (r.error || !r.data)
      throw new Error(r.error ?? "Could not confirm the operation");
    await chatRpc(client, "ai_chat_event", {
      p_conversation: p.conversationId,
      p_operation: r.data.id,
      p_content:
        r.data.status === "completed"
          ? `Database confirmed **${r.data.action.replaceAll("_", " ")}** for **${r.data.count}** records.`
          : `Review undo for **${r.data.count}** records below.`,
      p_token: aiServerToken(),
    });
    return { data: r.data };
  } catch (e) {
    return { error: message(e) };
  }
}
