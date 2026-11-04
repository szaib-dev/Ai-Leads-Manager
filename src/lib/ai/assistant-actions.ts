"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
import {
  modes,
  type ChatContext,
  type AiResult,
  type AssistantState,
} from "./assistant-contracts";
import { aiServerToken } from "./config";
import { rpc, message, maybeExecute, planAssistant } from "./assistant-service";
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
  return planAssistant(text, input, requestId);
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
  requestId: string = crypto.randomUUID(),
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
          p_request: z.uuid().parse(requestId),
          p_command: command,
          p_token: aiServerToken(),
        }),
      ),
    };
  } catch (e) {
    return { error: message(e) };
  }
}
