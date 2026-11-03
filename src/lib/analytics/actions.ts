"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
import {
  validTimeZone,
  type AnalyticsFilter,
  type AnalyticsReport,
  type RangeActivity,
} from "./contracts";
const filter = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    timezone: z.string().max(100).refine(validTimeZone),
    pageId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.to >= p.from &&
      (Date.parse(p.to) - Date.parse(p.from)) / 86400000 < 366,
    "Choose a range of at most 366 days",
  );
function message(e: unknown) {
  if (
    e instanceof Error &&
    "digest" in e &&
    String(e.digest).startsWith("NEXT_REDIRECT")
  )
    throw e;
  return e instanceof z.ZodError
    ? "Choose valid dates, a timezone, and a range of at most 366 days."
    : e instanceof Error
      ? e.message
      : "Analytics could not load.";
}
export async function fetchAnalytics(
  input: AnalyticsFilter,
): Promise<ActionResult<AnalyticsReport>> {
  try {
    const p = filter.parse(input);
    const { client } = await databaseContext();
    const r = await client.rpc("analytics_report", {
      p_from: p.from,
      p_to: p.to,
      p_timezone: p.timezone,
      p_page: p.pageId ?? null,
    } as never);
    if (r.error) throw new Error(r.error.message);
    return { data: r.data as unknown as AnalyticsReport };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function fetchActivityRange(
  input: AnalyticsFilter,
  page: number,
): Promise<ActionResult<RangeActivity>> {
  try {
    const p = filter.parse(input);
    const offset = (z.number().int().min(1).max(50000).parse(page) - 1) * 20;
    const { client, user } = await databaseContext();
    const r = await client.rpc("calling_history_range", {
      p_from: p.from,
      p_to: p.to,
      p_timezone: p.timezone,
      p_page: p.pageId ?? null,
      p_offset: offset,
      p_limit: 20,
    } as never);
    // Safe rolling deployment: call-only pagination still works before migration 007 reaches the server.
    if (r.error?.code === "PGRST202") {
      const reportResult = await client.rpc("analytics_report", {
        p_from: p.from,
        p_to: p.to,
        p_timezone: p.timezone,
        p_page: p.pageId ?? null,
      } as never);
      if (reportResult.error) throw new Error(reportResult.error.message);
      const report = reportResult.data as unknown as AnalyticsReport;
      let query = client
        .from("activity_events")
        .select("*", { count: "exact" })
        .eq("owner_id", user.id)
        .eq("kind", "call_attempt")
        .gte("occurred_at", report.start_at)
        .lt("occurred_at", report.end_at);
      if (p.pageId) query = query.eq("page_id", p.pageId);
      const events = await query
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 19);
      if (events.error) throw new Error(events.error.message);
      const rows = events.data ?? [],
        leadIds = rows.flatMap((e) => (e.lead_id ? [e.lead_id] : [])),
        attemptIds = rows.flatMap((e) => (e.attempt_id ? [e.attempt_id] : []));
      const [leads, attempts] = await Promise.all([
        leadIds.length
          ? client
              .from("leads")
              .select("id,business_name,location")
              .eq("owner_id", user.id)
              .in("id", leadIds)
          : Promise.resolve({ data: [], error: null }),
        attemptIds.length
          ? client
              .from("call_attempts")
              .select("id,notes")
              .eq("owner_id", user.id)
              .in("id", attemptIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (leads.error || attempts.error)
        throw new Error("Could not load call details.");
      return {
        data: {
          rows: rows.map((e) => ({
            ...e,
            business_name:
              leads.data?.find((l) => l.id === e.lead_id)?.business_name ??
              "Removed business",
            location:
              leads.data?.find((l) => l.id === e.lead_id)?.location ?? "",
            notes:
              attempts.data?.find((a) => a.id === e.attempt_id)?.notes ?? "",
          })),
          total: events.count ?? 0,
          summary: report.summary,
        },
      };
    }
    if (r.error) throw new Error(r.error.message);
    return { data: r.data as unknown as RangeActivity };
  } catch (e) {
    return { error: message(e) };
  }
}
