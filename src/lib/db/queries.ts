import "server-only";
import { databaseContext, checkDatabaseError } from "./context";
import {
  daySchema,
  leadListSchema,
  pageRange,
  uuidSchema,
} from "@/lib/validation/domain";
import type { z } from "zod";

// Foundation utilities only. The UI still consumes the separate mock provider.
export async function listLeadPages(
  pagination: { page?: number; pageSize?: number } = {},
) {
  const { user, client } = await databaseContext();
  const { from, to } = pageRange(pagination);
  const result = await client
    .from("lead_pages")
    .select("id,name,description,created_at,updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
export async function listLeads(input: z.input<typeof leadListSchema> = {}) {
  const parsed = leadListSchema.parse(input);
  const { from, to } = pageRange(parsed);
  const { user, client } = await databaseContext();
  let query = client
    .from("leads")
    .select(
      "id,page_id,import_id,business_name,phone,website_url,google_maps_url,country,location,status,created_at,last_contacted_at,archived_at",
    )
    .eq("owner_id", user.id)
    .is("deleted_at", null);
  query = parsed.archive
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);
  if (parsed.pageId) query = query.eq("page_id", parsed.pageId);
  if (parsed.importId) query = query.eq("import_id", parsed.importId);
  if (parsed.status) query = query.eq("status", parsed.status);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
export async function getLead(id: string) {
  const leadId = uuidSchema.parse(id);
  const { user, client } = await databaseContext();
  const result = await client
    .from("leads")
    .select("*")
    .eq("owner_id", user.id)
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  checkDatabaseError(result.error);
  return result.data;
}
export async function listImports(
  pageId: string,
  pagination: { page?: number; pageSize?: number } = {},
) {
  const id = uuidSchema.parse(pageId);
  const { from, to } = pageRange(pagination);
  const { user, client } = await databaseContext();
  const result = await client
    .from("imports")
    .select("*")
    .eq("owner_id", user.id)
    .eq("page_id", id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
export async function listAttempts(
  leadId: string,
  pagination: { page?: number; pageSize?: number } = {},
) {
  const id = uuidSchema.parse(leadId);
  const { from, to } = pageRange(pagination);
  const { user, client } = await databaseContext();
  const result = await client
    .from("call_attempts")
    .select("*")
    .eq("owner_id", user.id)
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
export async function listFollowups(
  startDay: string,
  endDay: string,
  pagination: { page?: number; pageSize?: number } = {},
) {
  const start = daySchema.parse(startDay),
    end = daySchema.parse(endDay);
  if (end < start) throw new Error("Invalid date range.");
  const { from, to } = pageRange(pagination);
  const { user, client } = await databaseContext();
  const result = await client
    .from("followups")
    .select("*")
    .eq("owner_id", user.id)
    .gte("scheduled_date", start)
    .lte("scheduled_date", end)
    .order("scheduled_date")
    .order("scheduled_time", { nullsFirst: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
export async function dailyActivity(day: string) {
  const p_day = daySchema.parse(day);
  const { client } = await databaseContext();
  const result = await client.rpc("daily_activity", { p_day });
  checkDatabaseError(result.error);
  return result.data?.[0] ?? null;
}
export async function listDailyEvents(
  day: string,
  pagination: { page?: number; pageSize?: number } = {},
) {
  const value = daySchema.parse(day);
  const start = `${value}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const { from, to } = pageRange(pagination);
  const { user, client } = await databaseContext();
  const result = await client
    .from("activity_events")
    .select("*")
    .eq("owner_id", user.id)
    .gte("occurred_at", start)
    .lt("occurred_at", end)
    .order("occurred_at", { ascending: false })
    .order("id")
    .range(from, to);
  checkDatabaseError(result.error);
  return result.data ?? [];
}
