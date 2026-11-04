"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
export interface Callback {
  id: string;
  lead_id: string;
  page_id: string;
  business_name: string;
  phone: string | null;
  expected_date: string | null;
  expected_time: string | null;
  reminder_at: string | null;
  notes: string;
  status: "Waiting" | "Overdue" | "Completed";
  lead_updated_at: string;
}
export async function fetchCallbacks(
  day: string,
  time: string,
  page: number,
): Promise<ActionResult<{ rows: Callback[]; total: number }>> {
  try {
    const { client } = await databaseContext();
    const r = await client.rpc(
      "workspace_callbacks" as never,
      {
        p_day: z.iso.date().parse(day),
        p_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .parse(time),
        p_offset: (z.number().int().min(1).max(50000).parse(page) - 1) * 20,
      } as never,
    );
    if (r.error) throw r.error;
    return { data: r.data as unknown as { rows: Callback[]; total: number } };
  } catch {
    return { error: "Could not load callbacks. Please retry." };
  }
}
export async function manageCallback(input: {
  id: string;
  expected: string;
  requestId: string;
  action: string;
  date?: string;
  time?: string;
  notes: string;
  reminder?: string;
}): Promise<ActionResult<true>> {
  try {
    const p = z
      .object({
        id: z.uuid(),
        expected: z.iso.datetime({ offset: true }),
        requestId: z.uuid(),
        action: z.enum([
          "reschedule",
          "called_back",
          "follow_up_myself",
          "not_interested",
        ]),
        date: z.iso.date().optional(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        notes: z.string().max(16000),
        reminder: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(input);
    const { client } = await databaseContext();
    const r = await client.rpc(
      "manage_callback" as never,
      {
        p_id: p.id,
        p_expected: p.expected,
        p_request: p.requestId,
        p_action: p.action,
        p_date: p.date ?? null,
        p_time: p.time ?? null,
        p_notes: p.notes,
        p_reminder: p.reminder ?? null,
      } as never,
    );
    if (r.error) throw r.error;
    return { data: true };
  } catch {
    return {
      error:
        "Could not save callback. Reload if this lead changed, then retry.",
    };
  }
}
