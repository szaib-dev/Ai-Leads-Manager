"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { fromDb } from "./contracts";
export async function fetchWhatsApp(page = 0) {
  const { client, user } = await databaseContext();
  const offset = z.number().int().min(0).max(10000).parse(page) * 15;
  const r = await client.from("leads").select("*,lead_pages!inner(deleted_at)", { count: "exact" }).eq("owner_id", user.id).eq("status", "whatsapp" as never).is("lead_pages.deleted_at", null).is("deleted_at", null).is("archived_at", null).order("updated_at", { ascending: false }).order("id").range(offset, offset + 14);
  if (r.error) return { error: r.error.message };
  return { data: { total: r.count || 0, rows: r.data.map(row => ({ lead: fromDb(row), status: String((row as Record<string, unknown>).whatsapp_status), notes: String((row as Record<string, unknown>).whatsapp_notes || ""), date: String((row as Record<string, unknown>).whatsapp_last_interaction || "") })) } };
}
export async function saveWhatsApp(input: { id: string; expected: string; status: string; notes: string; date: string }) {
  const p = z.object({ id: z.uuid(), expected: z.iso.datetime({ offset: true }), status: z.enum(["Waiting for Reply", "In Conversation", "Interested", "Closed"]), notes: z.string().max(16000), date: z.union([z.iso.date(), z.literal("")]) }).parse(input);
  const { client } = await databaseContext();
  const r = await client.rpc("manage_whatsapp" as never, { p_id: p.id, p_expected: p.expected, p_status: p.status, p_notes: p.notes, p_date: p.date || null } as never);
  return r.error ? { error: r.error.message } : { data: true as const };
}
