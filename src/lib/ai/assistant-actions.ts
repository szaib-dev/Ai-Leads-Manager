"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
import { assistantMessages, requestAssistant } from "./assistant-provider";
import {
  contextSchema,
  intentSchema,
  forbiddenCommand,
  validateInstruction,
  modes,
  type ChatContext,
  type Intent,
  type AiResult,
  type AssistantState,
} from "./assistant-contracts";
import { aiConfigured, aiServerToken } from "./config";
import type { ProviderUsage } from "./deepseek";
type Client = Awaited<ReturnType<typeof databaseContext>>["client"];
type Rpc =
  | "ai_context"
  | "ai_assistant_state"
  | "ai_set_mode"
  | "ai_stage"
  | "ai_plan_result"
  | "ai_execute"
  | "ai_cancel"
  | "ai_csv_reserve"
  | "ai_csv_settle";
async function rpc<T>(
  client: Client,
  name: Rpc,
  args: Record<string, unknown> = {},
) {
  const r = await client.rpc(name, args as never);
  if (r.error) throw new Error(r.error.message);
  return r.data as unknown as T;
}
function message(e: unknown) {
  if (
    e instanceof Error &&
    "digest" in e &&
    String(e.digest).startsWith("NEXT_REDIRECT")
  )
    throw e;
  return e instanceof z.ZodError
    ? "Please clarify the command or choose a narrower scope. No lead changes were made."
    : e instanceof Error
      ? e.message
      : "Request failed. Your workspace remains protected.";
}
interface Metadata {
  pages: { id: string; name: string }[];
  currentPage: string | null;
  selectedCount: number;
  verifiedRecentImport: string | null;
  imports: {
    id: string;
    page_id: string;
    file_name: string;
    batch_sequence: number;
  }[];
}
function resolvePage(ref: string, context: ChatContext, meta: Metadata) {
  if (ref === "all") return null;
  if (ref === "current") {
    if (!context.pageId)
      throw new Error("Open a lead page or explicitly ask across all pages.");
    return context.pageId;
  }
  const matches = meta.pages.filter(
    (p) => p.id === ref || p.name.toLowerCase() === ref.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      "Page reference is ambiguous or unavailable. Use an exact page name.",
    );
  return matches[0].id;
}
async function resolvePlan(
  client: Client,
  userId: string,
  intent: Intent,
  context: ChatContext,
  meta: Metadata,
) {
  const pageId =
    (intent.action === "undo_operation" ||
      intent.action === "undo_import" ||
      intent.selection !== "none") &&
    intent.page === "current" &&
    !context.pageId
      ? null
      : resolvePage(intent.page, context, meta);
  let importId: string | null = null,
    undoId: string | null = null;
  if (intent.import !== "none" || intent.action === "undo_import") {
    let q = client
      .from("imports")
      .select("id")
      .eq("owner_id", userId)
      .eq("status", "completed");
    if (pageId) q = q.eq("page_id", pageId);
    const reference =
      intent.import === "recent"
        ? context.recentImportId
        : !["latest", "none"].includes(intent.import)
          ? intent.import
          : undefined;
    if (intent.import === "recent" && !reference)
      throw new Error(
        "No verified recent import is selected. Ask for the latest import instead.",
      );
    if (reference) q = q.eq("id", z.uuid().parse(reference));
    const r = await q
      .order("batch_sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error || !r.data)
      throw new Error("No completed import exists in this scope.");
    importId = r.data.id;
  }
  if (intent.action === "undo_operation") {
    let q = client
      .from("operations")
      .select("id")
      .eq("owner_id", userId)
      .eq("source", "ai")
      .eq("status", "completed")
      .in("ai_action", [
        "edit",
        "append_notes",
        "delete",
        "archive",
        "archive_exhausted",
        "restore",
        "move",
      ])
      .gt("undo_expires_at", new Date().toISOString());
    if (pageId) q = q.eq("target_page_id", pageId);
    const r = await q
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error || !r.data)
      throw new Error("No eligible AI action is available for undo.");
    undoId = r.data.id;
  }
  const selectedIds =
    intent.selection === "selected" ? (context.selectedIds ?? []) : [];
  if (intent.selection === "selected" && !selectedIds.length)
    throw new Error("Select the leads you want to manage first.");
  if (intent.selection === "previous" && !context.previousResultId)
    throw new Error(
      "Run a search first so the previous result set can be verified.",
    );
  return {
    action: intent.action,
    pageId,
    importId,
    selectedIds,
    previousId:
      intent.selection === "previous" ? context.previousResultId : null,
    undoId,
    filter: intent.filter,
    changes: intent.changes,
    destinationId:
      intent.action === "move"
        ? resolvePage(
            intent.destination,
            { ...context, pageId: undefined },
            meta,
          )
        : null,
  };
}
async function maybeExecute(client: Client, result: AiResult) {
  if (result.status === "planned" && !result.requiresApproval)
    return rpc<AiResult>(client, "ai_execute", {
      p_id: result.id,
      p_approved: false,
      p_token: aiServerToken(),
    });
  return result;
}
export async function assistantState(): Promise<ActionResult<AssistantState>> {
  try {
    const { client } = await databaseContext();
    return { data: await rpc<AssistantState>(client, "ai_assistant_state") };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function setAssistantMode(
  mode: string,
): Promise<ActionResult<true>> {
  try {
    const { client } = await databaseContext();
    await rpc(client, "ai_set_mode", { p_mode: z.enum(modes).parse(mode) });
    return { data: true };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function askAssistant(
  text: string,
  input: ChatContext,
  requestId: string,
): Promise<ActionResult<{ reply?: string; result?: AiResult }>> {
  const { client, user } = await databaseContext();
  let reserved = false,
    usage: ProviderUsage | undefined;
  try {
    text = z.string().trim().min(2).max(2000).parse(text);
    z.uuid().parse(requestId);
    const context = contextSchema.parse(input);
    if (forbiddenCommand(text))
      return {
        data: {
          reply:
            "I cannot deduplicate or merge existing leads, reveal credentials, run SQL, or bypass safety rules. Only exact Google Maps URL equality automatically skips an incoming CSV duplicate; original records are always preserved.",
        },
      };
    const existing = await client
      .from("operations")
      .select("id")
      .eq("owner_id", user.id)
      .eq("request_id", requestId)
      .eq("source", "ai")
      .maybeSingle();
    if (existing.data)
      return {
        data: {
          result: await maybeExecute(
            client,
            await rpc<AiResult>(client, "ai_plan_result", {
              p_id: existing.data.id,
            }),
          ),
        },
      };
    if (!aiConfigured())
      throw new Error(
        "Add DEEPSEEK_API_KEY privately on the server to enable the assistant.",
      );
    const meta = await rpc<Metadata>(client, "ai_context", {
      p_page: context.pageId ?? null,
      p_selected: context.selectedIds,
      p_recent: context.recentImportId ?? null,
    });
    context.recentImportId = meta.verifiedRecentImport ?? undefined;
    const messages = assistantMessages(text, {
      ...meta,
      hasPreviousResults: !!context.previousResultId,
      previousConversation: context.history,
    });
    await rpc(client, "ai_csv_reserve", {
      p_request: requestId,
      p_input_bound: Buffer.byteLength(JSON.stringify(messages)) + 1024,
      p_server_token: aiServerToken(),
    });
    reserved = true;
    const answer = await requestAssistant(messages);
    usage = answer.usage;
    const intent = intentSchema.parse(answer.intent);
    if (intent.action === "clarify" || intent.action === "refuse")
      return {
        data: {
          reply:
            intent.question ||
            "Please specify the exact page, conditions, and change you want.",
        },
      };
    const mismatch = validateInstruction(intent, text, context.history);
    if (mismatch) return { data: { reply: mismatch } };
    const command = await resolvePlan(client, user.id, intent, context, meta);
    const plan = await rpc<AiResult>(client, "ai_stage", {
      p_request: requestId,
      p_command: command,
      p_token: aiServerToken(),
    });
    return { data: { result: await maybeExecute(client, plan) } };
  } catch (e) {
    if (e && typeof e === "object" && "usage" in e)
      usage = e.usage as ProviderUsage;
    return { error: message(e) };
  } finally {
    if (reserved) {
      try {
        await rpc(client, "ai_csv_settle", {
          p_request: requestId,
          p_input: usage?.input ?? null,
          p_output: usage?.output ?? null,
          p_server_token: aiServerToken(),
        });
      } catch {
        console.error(
          "AI usage settlement unavailable; conservative reservation remains charged.",
        );
      }
    }
  }
}
export async function confirmAiPlan(
  id: string,
): Promise<ActionResult<AiResult>> {
  try {
    const { client } = await databaseContext();
    return {
      data: await rpc<AiResult>(client, "ai_execute", {
        p_id: z.uuid().parse(id),
        p_approved: true,
        p_token: aiServerToken(),
      }),
    };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function aiResultPage(
  id: string,
  page: number,
): Promise<ActionResult<AiResult>> {
  try {
    const { client } = await databaseContext();
    return {
      data: await rpc<AiResult>(client, "ai_plan_result", {
        p_id: z.uuid().parse(id),
        p_offset: (z.number().int().min(1).max(501).parse(page) - 1) * 20,
      }),
    };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function cancelAiPlan(id: string): Promise<ActionResult<true>> {
  try {
    const { client } = await databaseContext();
    await rpc(client, "ai_cancel", { p_id: z.uuid().parse(id) });
    return { data: true };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function reviewAiUndo(
  id: string,
): Promise<ActionResult<AiResult>> {
  try {
    const { client } = await databaseContext();
    const command = {
      action: "undo_operation",
      undoId: z.uuid().parse(id),
      pageId: null,
      importId: null,
      destinationId: null,
      previousId: null,
      selectedIds: [],
      changes: {},
      filter: { logic: "and", groups: [] },
    };
    return {
      data: await maybeExecute(
        client,
        await rpc<AiResult>(client, "ai_stage", {
          p_request: crypto.randomUUID(),
          p_command: command,
          p_token: aiServerToken(),
        }),
      ),
    };
  } catch (e) {
    return { error: message(e) };
  }
}
