import type { Lead } from "@/types";
import type { FollowupTask, FollowupCategory } from "@/types/followup";
export const callOutcomes = [
  "no_answer",
  "voicemail",
  "interested",
  "not_interested",
  "callback_requested",
  "meeting_booked",
] as const;
export type CallOutcome = (typeof callOutcomes)[number];
export const outcomeLabels: Record<string, string> = {
  other: "Other",
  no_answer: "No Answer",
  voicemail: "Voicemail",
  interested: "Interested",
  not_interested: "Not Interested",
  callback_requested: "Callback Requested",
  meeting_booked: "Meeting Booked",
};
export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}
// Scheduling is literal local calendar input; no date/time offset conversion.
export function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export interface FollowupEntry extends FollowupTask {
  lead: Lead;
  category: FollowupCategory;
  updatedAt: string;
}
export interface FollowupList {
  rows: FollowupEntry[];
  total: number;
  counts: Record<FollowupCategory | "all", number>;
}
export interface ActivityEvent {
  attempt_number?: number | null;
  id: string;
  lead_id: string | null;
  kind: string;
  occurred_at: string;
  outcome: CallOutcome | "other" | null;
  from_status: string | null;
  to_status: string | null;
  voided_at: string | null;
  business_name: string;
  notes: string;
  location: string;
}
export interface DailySummary {
  calls_made: number;
  businesses_contacted: number;
  unanswered_calls: number;
  voicemails: number;
  interested_prospects: number;
  meetings_booked: number;
  callbacks_requested: number;
  followups_scheduled: number;
}
export interface ActivityResult {
  rows: ActivityEvent[];
  total: number;
  summary: DailySummary;
  connected: number;
}
export interface OverviewResult {
  active: number;
  interested: number;
  unanswered: number;
  followups: number;
  due_today: number;
  meetings: number;
  today: DailySummary;
  daily: { activity_day: string; calls: number }[];
  recent: ActivityEvent[];
}
export interface LeadHistoryResult {
  attempts: {
    attempt_number?: number;
    id: string;
    occurred_at: string;
    outcome: CallOutcome;
    notes: string;
    voided_at: string | null;
  }[];
  total: number;
  changes: {
    id: string;
    kind: string;
    attempt_id: string | null;
    created_at: string;
    undone_at: string | null;
  }[];
  undo_id: string | null;
}
export const eventLabels: Record<string, string> = {
  call_attempt: "Call attempt",
  status_changed: "Status changed",
  archived: "Archived",
  restored: "Restored",
  followup_scheduled: "Follow-up scheduled",
  meeting_scheduled: "Meeting scheduled",
  followup_updated: "Follow-up updated",
  followup_completed: "Follow-up completed",
  followup_cancelled: "Follow-up cancelled",
  change_reverted: "Change corrected",
  lead_deleted: "Lead deleted",
  lead_purged: "Business details removed",
};
