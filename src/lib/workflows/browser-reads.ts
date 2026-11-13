"use client";
import { z } from "zod";
import { uuidSchema } from "@/lib/validation/domain";
import { fromDb, type ActionResult } from "@/lib/leads/contracts";
import type { FollowupList, ActivityResult, OverviewResult, LeadHistoryResult } from "@/lib/leads/workflow-contracts";
import { createClient } from "@/lib/supabase/browser";
import type { Database } from "@/types/database";
async function rpc(name:keyof Database["public"]["Functions"],args:Record<string,unknown>){const r=await createClient().rpc(name,args as never);if(r.error)throw new Error(r.error.message);return r.data;}
function errorMessage(e:unknown){return e instanceof Error?e.message:"Could not load workspace data";}
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
