"use client";
import type { Lead } from "@/types";
const listeners = new Set<(lead: Lead) => void>();
// An in-memory notification to mounted bounded lists; never a cross-user record cache.
export function publishLead(lead: Lead) {
  for (const listener of listeners) listener(lead);
}
export function subscribeLeadChanges(listener: (lead: Lead) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function replaceLead(rows: Lead[], lead: Lead) {
  return rows.map((row) =>
    row.id === lead.id &&
    (!row.updatedAt || !lead.updatedAt || row.updatedAt <= lead.updatedAt)
      ? lead
      : row,
  );
}
