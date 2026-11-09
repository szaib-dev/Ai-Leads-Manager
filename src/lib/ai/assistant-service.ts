import "server-only";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
import { assistantMessages, requestAssistant } from "./assistant-provider";
import {
  contextSchema,
  intentSchema,
  forbiddenCommand,
  validateInstruction,
  type ChatContext,
  type Intent,
  type AiResult,
  deletionCountryGuard,
} from "./assistant-contracts";
import { aiConfigured, aiServerToken } from "./config";
import type { ProviderUsage } from "./deepseek";
import { analyzeResult } from "./relevance";
import { isRelevanceQuestion } from "./relevance-contracts";
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
export async function rpc<T>(
  client: Client,
  name: Rpc,
  args: Record<string, unknown> = {},
) {
  const r = await client.rpc(name, args as never);
  if (r.error) throw new Error(r.error.message);
  return r.data as unknown as T;
}
export function message(e: unknown) {
  if (
    e instanceof Error &&
    "digest" in e &&
    String(e.digest).startsWith("NEXT_REDIRECT")
  )
    throw e;
  if (
    e instanceof Error &&
    /Set DEEPSEEK_API_KEY|DeepSeek is not configured/.test(e.message)
  )
    return "AI is not configured yet. Your file and conversation are saved.";
  if (
    e instanceof Error &&
    /(?:column|function|relation) .*does not exist|schema cache|permission denied|violates .*constraint|syntax error|invalid input syntax|SQLSTATE|PGRST/i.test(
      e.message,
    )
  ) {
    console.error("AI database request failed", e);
    return "Chat is temporarily unavailable. Please retry shortly; your conversations are saved.";
  }
  return e instanceof z.ZodError
    ? "The request could not be validated. Please retry; no lead changes were made."
    : e instanceof Error
      ? e.message
      : "Request failed. Your workspace remains protected.";
}
interface Metadata {
  pages: { id: string; name: string; country?: string }[];
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
    return context.pageId ?? null;
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
  if (
    intent.changes.phone_cleanup &&
    !pageId &&
    intent.selection === "none" &&
    intent.import === "none"
  )
    throw new Error("Choose a lead page, selected leads, or an import for phone cleanup.");
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
export async function maybeExecute(client: Client, result: AiResult) {
  if (result.status === "planned" && !result.requiresApproval)
    return rpc<AiResult>(client, "ai_execute", {
      p_id: result.id,
      p_approved: false,
      p_token: aiServerToken(),
    });
  return result;
}
export async function planAssistant(
  text: string,
  input: ChatContext,
  requestId: string,
  options: {
    stage?: (stage: string) => void;
    signal?: AbortSignal;
    memory?: unknown;
    budgetId?: string;
  } = {},
): Promise<ActionResult<{ reply?: string; result?: AiResult }>> {
  const { client, user } = await databaseContext();
  const budgetRequest = options.budgetId ?? requestId;
  let reserved = false,
    usage: ProviderUsage | undefined;
  try {
    text = z.string().trim().min(2).max(2000).parse(text);
    z.uuid().parse(requestId);
    const parsedContext = contextSchema.safeParse(input);
    if (!parsedContext.success) {
      console.warn("AI context validation failed", {
        fields: parsedContext.error.issues.map((i) => i.path.join(".")),
      });
      throw new Error(
        "Workspace context could not be validated. Reopen this chat and retry.",
      );
    }
    const context = parsedContext.data;
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
    if (existing.data) {
      const result = await maybeExecute(
        client,
        await rpc<AiResult>(client, "ai_plan_result", {
          p_id: existing.data.id,
        }),
      );
      if (
        result.count > 0 &&
        ((result.analysis && !result.analysis.items.length) ||
          (!result.analysis && isRelevanceQuestion(text)))
      ) {
        options.stage?.("Retrying business relevance analysis…");
        return {
          data: {
            result: await analyzeResult(
              client,
              result,
              result.analysis?.criteria ?? text,
              0,
              options.signal,
            ),
          },
        };
      }
      return { data: { result } };
    }
    if (isRelevanceQuestion(text)) {
      options.stage?.("Finding businesses to analyze…");
      const plan = await rpc<AiResult>(client, "ai_stage", {
        p_request: requestId,
        p_command: {
          action: "search",
          pageId: context.pageId ?? null,
          importId: null,
          selectedIds: context.selectedIds,
          previousId:
            !context.selectedIds.length &&
            /\b(?:these|those|previous)\b/i.test(text)
              ? (context.previousResultId ?? null)
              : null,
          undoId: null,
          filter: { logic: "and", groups: [] },
          changes: {},
          destinationId: null,
        },
        p_token: aiServerToken(),
      });
      options.stage?.("Analyzing business relevance in a bounded batch…");
      return {
        data: {
          result: await analyzeResult(client, plan, text, 0, options.signal),
        },
      };
    }
    if (/^how many (?:total )?leads do i have[?.! ]*$/i.test(text)) {
      options.stage?.("Searching leads…");
      const plan = await rpc<AiResult>(client, "ai_stage", {
        p_request: requestId,
        p_command: {
          action: "search",
          pageId: null,
          importId: null,
          selectedIds: [],
          previousId: null,
          undoId: null,
          filter: { logic: "and", groups: [] },
          changes: {},
          destinationId: null,
        },
        p_token: aiServerToken(),
      });
      options.stage?.("Fetching matching records…");
      return { data: { result: plan } };
    }
    if (!aiConfigured())
      throw new Error(
        "Add DEEPSEEK_API_KEY privately on the server to enable the assistant.",
      );
    options.stage?.("Checking workspace context…");
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
      retrievedConversation: options.memory,
    });
    await rpc(client, "ai_csv_reserve", {
      p_request: budgetRequest,
      p_input_bound: Buffer.byteLength(JSON.stringify(messages)) + 1024,
      p_server_token: aiServerToken(),
    });
    reserved = true;
    options.stage?.("Understanding your request…");
    const answer = await requestAssistant(messages, fetch, options.signal);
    options.signal?.throwIfAborted();
    usage = answer.usage;
    const intent = intentSchema.parse(answer.intent);
    if (intent.action === "analyze") {
      const command = await resolvePlan(
        client,
        user.id,
        { ...intent, action: "search", changes: {} },
        context,
        meta,
      );
      const plan = await rpc<AiResult>(client, "ai_stage", {
        p_request: requestId,
        p_command: command,
        p_token: aiServerToken(),
      });
      options.stage?.("Analyzing business relevance in a bounded batch…");
      return {
        data: {
          result: await analyzeResult(client, plan, text, 0, options.signal),
        },
      };
    }
    if (
      intent.action === "answer" ||
      intent.action === "clarify" ||
      intent.action === "refuse"
    )
      return {
        data: {
          reply:
            intent.question ||
            "Please specify the exact page, conditions, and change you want.",
        },
      };
    const mismatch = validateInstruction(intent, text, context.history);
    if (mismatch) return { data: { reply: mismatch } };
    const explicitSelection = text.match(
      /\b(?:these|the)\s+(\d+)\s+(?:selected\s+)?(?:businesses|leads|records)\b/i,
    );
    if (
      intent.selection === "selected" &&
      explicitSelection &&
      Number(explicitSelection[1]) !== context.selectedIds.length
    )
      return {
        data: {
          reply: `You have ${context.selectedIds.length} leads selected, but requested ${explicitSelection[1]}. Adjust the selection before continuing.`,
        },
      };
    const command = await resolvePlan(client, user.id, intent, context, meta);
    const country = deletionCountryGuard(
      intent,
      text,
      command.pageId
        ? meta.pages.find((p) => p.id === command.pageId)?.name
        : undefined,
    );
    if (country) return { data: { reply: country } };
    options.stage?.(
      intent.action === "search" ? "Searching leads…" : "Preparing changes…",
    );
    const plan = await rpc<AiResult>(client, "ai_stage", {
      p_request: requestId,
      p_command: command,
      p_token: aiServerToken(),
    }).catch((error: unknown) => {
      if (intent.changes.phone_cleanup && error instanceof Error && error.message === "Unsupported changes")
        throw new Error("Phone cleanup requires the latest Supabase migration. Ask a workspace administrator to apply migration 202611090026.");
      throw error;
    });
    options.signal?.throwIfAborted();
    options.stage?.(
      plan.status === "completed"
        ? "Fetching matching records…"
        : plan.requiresApproval
          ? "Waiting for approval…"
          : "Applying validated changes…",
    );
    return { data: { result: await maybeExecute(client, plan) } };
  } catch (e) {
    if (e && typeof e === "object" && "usage" in e)
      usage = e.usage as ProviderUsage;
    return { error: message(e) };
  } finally {
    if (reserved) {
      try {
        await rpc(client, "ai_csv_settle", {
          p_request: budgetRequest,
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
