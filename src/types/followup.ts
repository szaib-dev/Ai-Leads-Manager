import type { LeadStatus } from "@/types";

export type FollowupCategory = "overdue" | "today" | "upcoming" | "completed";
export interface FollowupTask {
  id: string;
  leadId: string;
  date: string;
  time?: string;
  note: string;
  completed: boolean;
  outcome?: LeadStatus;
}

export function followupCategory(
  task: FollowupTask,
  today: string,
): FollowupCategory {
  if (task.completed) return "completed";
  return task.date < today
    ? "overdue"
    : task.date === today
      ? "today"
      : "upcoming";
}
