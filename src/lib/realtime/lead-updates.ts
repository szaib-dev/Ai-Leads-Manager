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

export type LeadPatch = Pick<Lead,"id"|"status"|"updatedAt"|"archived"|"deleted">;
const patchListeners=new Set<(patch:LeadPatch)=>void>();
export function publishLeadPatch(patch:LeadPatch){for(const listener of patchListeners)listener(patch);}
export function subscribeLeadPatches(listener:(patch:LeadPatch)=>void){patchListeners.add(listener);return ()=>{patchListeners.delete(listener);};}
export function patchLead(rows:Lead[],patch:LeadPatch){return rows.map(row=>row.id===patch.id && (!row.updatedAt || (patch.updatedAt && row.updatedAt<=patch.updatedAt)) ? {...row,...patch} : row);}
