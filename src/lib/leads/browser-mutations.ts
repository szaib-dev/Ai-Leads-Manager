"use client";
import { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { uuidSchema } from "@/lib/validation/domain";
import { editSchema } from "./edit-contract";
import { fromDb, type ActionResult } from "./contracts";
// The RPC enforces ownership, field restrictions, workflow history and stale-write protection.
// Send confirmed edits directly so background Server Action reads cannot queue a save.
export async function saveLead(input: {
  id: string; expected: string; data: unknown;
  action?: "edit" | "delete" | "archive" | "restore";
}): Promise<ActionResult<true>> {
  try {
    const id = uuidSchema.parse(input.id);
    const expected = z.iso.datetime({ offset: true }).parse(input.expected);
    const data = editSchema.parse(input.data);
    const action = z.enum(["edit", "delete", "archive", "restore"]).parse(input.action || "edit");
    const result = await createClient().rpc("save_lead", {
      p_id: id, p_expected: expected, p_data: data, p_action: action,
    });
    if (result.error) return { error: result.error.message };
    return { data: true };
  } catch (error) {
    return { error: error instanceof z.ZodError ? "Check the supplied fields and try again." : "Could not save lead. Please try again." };
  }
}

export async function fetchLeadRecord(leadId: string, ownerId: string): Promise<ActionResult<ReturnType<typeof fromDb>>> {
  try {
    const id = uuidSchema.parse(leadId), owner = uuidSchema.parse(ownerId), client = createClient();
    const [lead, attempts, suppression, followup] = await Promise.all([
      client.from("leads").select("*").eq("id", id).eq("owner_id", owner).is("deleted_at", null).maybeSingle(),
      client.from("lead_attempt_summary").select("*").eq("lead_id", id).eq("owner_id", owner).maybeSingle(),
      client.rpc("is_lead_suppressed", { p_lead_id: id }),
      client.from("followups").select("scheduled_date,scheduled_time").eq("lead_id", id).eq("owner_id", owner).is("completed_at", null).is("cancelled_at", null).maybeSingle(),
    ]);
    if (lead.error || attempts.error || suppression.error || followup.error || !lead.data)
      return { error: "Lead unavailable. Its details may have been removed." };
    return { data: fromDb({ ...lead.data, attempts: attempts.data?.total_attempts,
      failed_attempts: attempts.data?.consecutive_failed_attempts, last_attempt_at: attempts.data?.last_attempt_at,
      suppressed: suppression.data, followup: followup.data?.scheduled_date, followup_time: followup.data?.scheduled_time }) };
  } catch { return { error: "Could not reload lead. Please try again." }; }
}
