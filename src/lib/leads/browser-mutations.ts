"use client";
import { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { uuidSchema } from "@/lib/validation/domain";
import { editSchema } from "./edit-contract";
import type { ActionResult } from "./contracts";
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
