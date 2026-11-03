import type { Lead, LeadPage } from "@/types";
export interface PageWithCounts extends LeadPage {
  leadCount: number;
  newCount: number;
  contactedCount: number;
  followupCount: number;
}
export interface LeadFilters {
  search: string;
  status: string;
  phoneOnly: boolean;
  sort: "newest" | "name" | "attempts";
  page: number;
}
export interface LeadResult {
  rows: Lead[];
  total: number;
  summary: {
    total: number;
    ready: number;
    contacted: number;
    unanswered: number;
  };
}
export interface ImportResult {
  id: string;
  pageId: string;
  imported: number;
  duplicates: number;
  invalid: number;
  replaced: number;
}
export type ActionResult<T> =
  { data: T; error?: never } | { data?: never; error: string };
export const statusToDb: Record<string, string> = {
  New: "new",
  "No Answer": "no_answer",
  Voicemail: "voicemail",
  Interested: "interested",
  "Not Interested": "not_interested",
  "Follow-up": "follow_up",
  "Meeting Booked": "meeting_booked",
};
export function fromDb(row: Record<string, unknown>): Lead {
  const text = (key: string) =>
    typeof row[key] === "string" ? (row[key] as string) : "";
  return {
    id: text("id"),
    pageId: text("page_id"),
    name: text("business_name"),
    phone: text("phone"),
    website: text("website_url"),
    mapsUrl: text("google_maps_url"),
    city: text("location"),
    country: text("country"),
    category: text("country") || "Business",
    notes: text("notes"),
    status: (Object.keys(statusToDb).find(
      (key) => statusToDb[key] === row.status,
    ) || "New") as Lead["status"],
    attempts: Number(row.attempts || 0),
    failedAttempts: Number(row.failed_attempts || 0),
    created: text("created_at").slice(0, 10),
    createdAt: text("created_at"),
    contactedAt: text("last_contacted_at") || undefined,
    contacted: text("last_contacted_at").slice(0, 10) || null,
    archived: !!row.archived_at,
    archivedAt: text("archived_at").slice(0, 10) || undefined,
    archivedTimestamp: text("archived_at") || undefined,
    updatedAt: text("updated_at"),
    importId: text("import_id") || undefined,
    suppressed: row.suppressed === true,
    archiveReason: text("archive_reason") || undefined,
    purgeAfter: text("purge_after") || undefined,
    lastAttemptAt: text("last_attempt_at") || undefined,
    lastAttemptNotes: text("last_attempt_notes"),
    followup: text("followup") || undefined,
    followupTime: text("followup_time").slice(0, 5) || undefined,
  };
}
