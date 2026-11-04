"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "./contracts";
export interface SelectedLead {
  id: string;
  name: string;
  expected: string;
}
export async function previewLeadSelection(
  input: string[],
): Promise<ActionResult<SelectedLead[]>> {
  try {
    const ids = z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine((v) => new Set(v).size === v.length)
      .parse(input);
    const { client, user } = await databaseContext();
    const r = await client
      .from("leads")
      .select("id,business_name,updated_at,lead_pages!inner(deleted_at)")
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .is("lead_pages.deleted_at", null)
      .in("id", ids);
    if (r.error) throw new Error(r.error.message);
    if (r.data.length !== ids.length)
      throw new Error(
        "Some selected leads are unavailable. Refresh the selection before deleting.",
      );
    return {
      data: r.data.map((l) => ({
        id: l.id,
        name: l.business_name,
        expected: l.updated_at,
      })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Selection unavailable" };
  }
}
export async function deleteLeadSelection(
  requestId: string,
  rows: SelectedLead[],
): Promise<ActionResult<number>> {
  try {
    const request = z.uuid().parse(requestId);
    const items = z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string(),
            expected: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .parse(rows);
    const { client } = await databaseContext();
    const r = await client.rpc(
      "delete_lead_selection" as never,
      {
        p_request: request,
        p_items: items.map((l) => ({ id: l.id, expected: l.expected })),
      } as never,
    );
    if (r.error) throw new Error(r.error.message);
    return { data: Number(r.data) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Deletion failed" };
  }
}
export async function undoLeadSelection(
  requestId: string,
): Promise<ActionResult<true>> {
  try {
    const { client } = await databaseContext();
    const r = await client.rpc(
      "undo_lead_selection" as never,
      { p_request: z.uuid().parse(requestId) } as never,
    );
    if (r.error) throw new Error(r.error.message);
    return { data: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Undo failed" };
  }
}
