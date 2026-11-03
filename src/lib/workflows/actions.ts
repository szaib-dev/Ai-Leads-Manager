"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { assertOutreachAllowed } from "@/lib/domain/outreach";
import { uuidSchema } from "@/lib/validation/domain";
import { fromDb, type ActionResult } from "@/lib/leads/contracts";
import {
  callOutcomes,
  type FollowupList,
  type ActivityResult,
  type OverviewResult,
  type LeadHistoryResult,
} from "@/lib/leads/workflow-contracts";
import type { Database } from "@/types/database";
type Functions = Database["public"]["Functions"];
async function rpc<N extends keyof Functions>(
  name: N,
  args: { [K in keyof Functions[N]["Args"]]: Functions[N]["Args"][K] | null },
) {
  const { client } = await databaseContext();
  const r = await client.rpc(name, args as never);
  if (r.error) throw new Error(r.error.message);
  return r.data as Functions[N]["Returns"];
}
function errorMessage(e: unknown) {
  if (
    e instanceof Error &&
    "digest" in e &&
    String(e.digest).startsWith("NEXT_REDIRECT")
  )
    throw e;
  return e instanceof z.ZodError
    ? "Check the date, time and supplied fields."
    : e instanceof Error
      ? e.message
      : "Request failed. Please retry.";
}
const base = {
  leadId: uuidSchema,
  expected: z.iso.datetime({ offset: true }),
  requestId: uuidSchema,
};
const notes = z
  .string()
  .refine(
    (s) => new TextEncoder().encode(s).length <= 16000,
    "Notes exceed 16 KB",
  );
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional();
const attemptSchema = z
  .object({
    ...base,
    outcome: z.enum(callOutcomes),
    notes,
    date: z.iso.date().optional(),
    time,
    followupId: uuidSchema.optional(),
  })
  .strict();
export async function recordCall(
  input: z.input<typeof attemptSchema>,
): Promise<ActionResult<string>> {
  try {
    const p = attemptSchema.parse(input);
    const id = await rpc("record_call", {
      p_lead: p.leadId,
      p_expected: p.expected,
      p_request: p.requestId,
      p_outcome: p.outcome,
      p_notes: p.notes,
      p_date: p.date ?? null,
      p_time: p.time ?? null,
      p_followup: p.followupId ?? null,
    });
    return { data: id };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
const followupSchema = z
  .object({
    ...base,
    id: uuidSchema.optional(),
    action: z.enum(["schedule", "complete", "cancel"]),
    date: z.iso.date().optional(),
    time,
    notes: notes.default(""),
  })
  .strict();
export async function changeFollowup(
  input: z.input<typeof followupSchema>,
): Promise<ActionResult<string>> {
  try {
    const p = followupSchema.parse(input);
    const id = await rpc("manage_followup", {
      p_lead: p.leadId,
      p_expected: p.expected,
      p_request: p.requestId,
      p_id: p.id ?? null,
      p_action: p.action,
      p_date: p.date ?? null,
      p_time: p.time ?? null,
      p_notes: p.notes,
    });
    return { data: id };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function undoWorkflow(id: string): Promise<ActionResult<true>> {
  try {
    await rpc("undo_workflow", { p_id: uuidSchema.parse(id) });
    return { data: true };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function authorizeCall(
  leadId: string,
): Promise<ActionResult<string>> {
  try {
    const { leadId: id } = await assertOutreachAllowed(leadId);
    const { client, user } = await databaseContext();
    const r = await client
      .from("leads")
      .select("phone")
      .eq("id", id)
      .eq("owner_id", user.id)
      .single();
    if (r.error || !r.data.phone) throw new Error("No phone number available.");
    return { data: r.data.phone };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function fetchFollowups(
  day: string,
  category: string,
  sort: string,
  page: number,
): Promise<ActionResult<FollowupList>> {
  try {
    const p = z
      .object({
        day: z.iso.date(),
        category: z.enum(["all", "overdue", "today", "upcoming", "completed"]),
        sort: z.enum(["asc", "desc"]),
        page: z.number().int().min(1).max(50000),
      })
      .parse({ day, category, sort, page });
    const data = (await rpc("workspace_followups", {
      p_day: p.day,
      p_category: p.category,
      p_sort: p.sort,
      p_offset: (p.page - 1) * 20,
      p_limit: 20,
    })) as unknown as {
      rows: Record<string, unknown>[];
      total: number;
      counts: FollowupList["counts"];
    };
    return {
      data: {
        ...data,
        rows: data.rows.map((r) => ({
          id: String(r.id),
          leadId: String(r.lead_id),
          date: String(r.scheduled_date),
          time: r.scheduled_time
            ? String(r.scheduled_time).slice(0, 5)
            : undefined,
          note: String(r.notes || ""),
          completed: !!r.completed_at,
          updatedAt: String(r.updated_at),
          category: r.category as FollowupList["rows"][number]["category"],
          outcome: r.completion_outcome
            ? fromDb({
                status:
                  r.completion_outcome === "callback_requested"
                    ? "follow_up"
                    : r.completion_outcome,
              }).status
            : undefined,
          lead: fromDb(r.lead as Record<string, unknown>),
        })),
      },
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function fetchActivity(
  day: string,
  page: number,
): Promise<ActionResult<ActivityResult>> {
  try {
    const p = z
      .object({ day: z.iso.date(), page: z.number().int().min(1).max(50000) })
      .parse({ day, page });
    return {
      data: (await rpc("workspace_activity", {
        p_day: p.day,
        p_offset: (p.page - 1) * 20,
        p_limit: 20,
      })) as unknown as ActivityResult,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function fetchOverview(
  day: string,
): Promise<ActionResult<OverviewResult>> {
  try {
    return {
      data: (await rpc("workspace_overview", {
        p_day: z.iso.date().parse(day),
      })) as unknown as OverviewResult,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function fetchLeadHistory(
  leadId: string,
  page: number,
): Promise<ActionResult<LeadHistoryResult>> {
  try {
    return {
      data: (await rpc("workspace_lead_history", {
        p_lead: uuidSchema.parse(leadId),
        p_offset: (z.number().int().min(1).max(50000).parse(page) - 1) * 10,
        p_limit: 10,
      })) as unknown as LeadHistoryResult,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
export async function fetchLeadRecord(
  leadId: string,
): Promise<ActionResult<ReturnType<typeof fromDb>>> {
  try {
    const id = uuidSchema.parse(leadId);
    const { client, user } = await databaseContext();
    const [lead, attempts, suppression, followup] = await Promise.all([
      client
        .from("leads")
        .select("*")
        .eq("id", id)
        .eq("owner_id", user.id)
        .is("deleted_at", null)
        .maybeSingle(),
      client
        .from("lead_attempt_summary")
        .select("*")
        .eq("lead_id", id)
        .eq("owner_id", user.id)
        .maybeSingle(),
      client.rpc("is_lead_suppressed", { p_lead_id: id }),
      client
        .from("followups")
        .select("scheduled_date,scheduled_time")
        .eq("lead_id", id)
        .eq("owner_id", user.id)
        .is("completed_at", null)
        .is("cancelled_at", null)
        .maybeSingle(),
    ]);
    if (
      lead.error ||
      attempts.error ||
      suppression.error ||
      followup.error ||
      !lead.data
    )
      throw new Error("Lead unavailable. Its details may have been removed.");
    return {
      data: fromDb({
        ...lead.data,
        attempts: attempts.data?.total_attempts,
        failed_attempts: attempts.data?.consecutive_failed_attempts,
        last_attempt_at: attempts.data?.last_attempt_at,
        suppressed: suppression.data,
        followup: followup.data?.scheduled_date,
        followup_time: followup.data?.scheduled_time,
      }),
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
