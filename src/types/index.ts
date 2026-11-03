export const statuses = [
  "New",
  "No Answer",
  "Voicemail",
  "Interested",
  "Not Interested",
  "Follow-up",
  "Meeting Booked",
] as const;
export type LeadStatus = (typeof statuses)[number];
export interface Lead {
  country?: string;
  updatedAt?: string;
  importId?: string;
  createdAt?: string;
  contactedAt?: string;
  suppressed?: boolean;
  archiveReason?: string;
  purgeAfter?: string;
  lastAttemptAt?: string;
  lastAttemptNotes?: string;
  id: string;
  pageId: string;
  name: string;
  category: string;
  city: string;
  phone: string;
  website: string;
  mapsUrl: string;
  status: LeadStatus;
  attempts: number;
  failedAttempts: number;
  notes: string;
  created: string;
  contacted: string | null;
  archived: boolean;
  archivedAt?: string;
  archivedTimestamp?: string;
  followup?: string;
  followupTime?: string;
}
export interface LeadPage {
  createdAt?: string;
  id: string;
  name: string;
  description: string;
  flag: string;
  color: string;
  created: string;
}
export interface Activity {
  id: string;
  leadId: string;
  name: string;
  outcome: LeadStatus;
  date: string;
  time: string;
  notes: string;
}
