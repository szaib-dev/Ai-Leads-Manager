"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { createPageSchema, uuidSchema } from "@/lib/validation/domain";
import { cleanupSchema } from "@/lib/imports/cleanup";
import { fields, mapRows, parseCsv } from "@/lib/imports/csv";
import {
  fromDb,
  statusToDb,
  type ActionResult,
  type PageWithCounts,
  type LeadResult,
  type ImportResult,
} from "./contracts";
import type { Database } from "@/types/database";
type Functions = Database["public"]["Functions"];
type NullableArgs<T> = { [Key in keyof T]: T[Key] | null };
async function rpc<Name extends keyof Functions>(
  name: Name,
  ...args: Functions[Name]["Args"] extends never
    ? []
    : Record<string, never> extends Functions[Name]["Args"]
      ? [args?: NullableArgs<Functions[Name]["Args"]>]
      : [args: NullableArgs<Functions[Name]["Args"]>]
) {
  const { client } = await databaseContext();
  // Generated PostgREST types omit SQL argument nullability. NullableArgs restores it.
  const result = await client.rpc(name, args[0] as never);
  if (result.error) throw new Error(result.error.message);
  return result.data as Functions[Name]["Returns"];
}
function message(error: unknown) {
  if (
    error instanceof Error &&
    "digest" in error &&
    String(error.digest).startsWith("NEXT_REDIRECT")
  )
    throw error;
  return error instanceof z.ZodError
    ? "Check the supplied fields and try again."
    : error instanceof Error
      ? error.message
      : "Request failed. Please try again.";
}
export async function fetchWorkspaceState(): Promise<
  ActionResult<{ pages: PageWithCounts[]; revision: number }>
> {
  try {
    const raw = (await rpc("workspace_state")) as unknown as {
      pages: {
        id: string;
        name: string;
        description: string;
        created_at: string;
        lead_count: number;
        new_count: number;
        contacted_count: number;
        followup_count: number;
      }[];
      revision: number;
    };
    return {
      data: {
        revision: Number(raw.revision),
        pages: raw.pages.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          flag: p.name.slice(0, 2).toUpperCase(),
          color: "blue",
          created: p.created_at.slice(0, 10),
          createdAt: p.created_at,
          leadCount: p.lead_count,
          newCount: p.new_count,
          contactedCount: p.contacted_count,
          followupCount: p.followup_count ?? 0,
        })),
      },
    };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function fetchPages(): Promise<ActionResult<PageWithCounts[]>> {
  const r = await fetchWorkspaceState();
  return r.data ? { data: r.data.pages } : { error: r.error };
}
const filterSchema = z
  .object({
    pageId: uuidSchema.optional(),
    mode: z.enum(["page", "archive", "attempts"]),
    search: z.string().max(200),
    status: z.string().max(30),
    phoneOnly: z.boolean(),
    sort: z.enum(["newest", "name", "attempts"]),
    page: z.number().int().min(1).max(125001),
  })
  .strict();
export async function fetchLeads(
  input: z.input<typeof filterSchema>,
): Promise<ActionResult<LeadResult>> {
  try {
    const p = filterSchema.parse(input);
    const data = (await rpc("workspace_leads", {
      p_page: p.pageId ?? null,
      p_mode: p.mode,
      p_search: p.search.trim(),
      p_status: statusToDb[p.status] || p.status,
      p_phone: p.phoneOnly,
      p_sort: p.sort,
      p_offset: (p.page - 1) * 15,
      p_limit: 15,
    })) as unknown as Omit<LeadResult, "rows"> & {
      rows: Record<string, unknown>[];
    };
    return { data: { ...data, rows: data.rows.map(fromDb) } };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function managePage(input: {
  id?: string;
  name?: string;
  description?: string;
  remove?: boolean;
}): Promise<ActionResult<string>> {
  try {
    const id = input.id ? uuidSchema.parse(input.id) : null;
    const data = input.remove
      ? null
      : createPageSchema.parse({
          name: input.name,
          description: input.description,
        });
    const result = await rpc("manage_page", {
      p_id: id,
      p_name: data?.name ?? null,
      p_description: data?.description ?? "",
      p_delete: !!input.remove,
    });
    return { data: result as string };
  } catch (error) {
    return { error: message(error) };
  }
}
const editSchema = z
  .object({
    business_name: z.string().trim().min(1).max(300).optional(),
    phone: z.string().trim().max(80).optional(),
    website_url: z
      .string()
      .max(4096)
      .refine(
        (v) => !v || (/^https?:\/\//i.test(v) && z.url().safeParse(v).success),
      )
      .optional(),
    country: z.string().max(100).optional(),
    location: z.string().max(300).optional(),
    notes: z
      .string()
      .refine((v) => new TextEncoder().encode(v).length <= 16000)
      .optional(),
    scheduled_date: z.iso.date().optional(),
    scheduled_time: z
      .string()
      .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    status: z
      .enum([
        "new",
        "no_answer",
        "voicemail",
        "interested",
        "not_interested",
        "follow_up",
        "meeting_booked",
      ])
      .optional(),
  })
  .strict();
export async function saveLead(input: {
  id: string;
  expected: string;
  data: unknown;
  action?: "edit" | "delete" | "archive" | "restore";
}): Promise<ActionResult<true>> {
  try {
    const id = uuidSchema.parse(input.id),
      expected = z.iso.datetime({ offset: true }).parse(input.expected),
      data = editSchema.parse(input.data),
      action = z
        .enum(["edit", "delete", "archive", "restore"])
        .parse(input.action || "edit");
    await rpc("save_lead", {
      p_id: id,
      p_expected: expected,
      p_data: data,
      p_action: action,
    });
    return { data: true };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function importCsv(
  form: FormData,
): Promise<ActionResult<ImportResult>> {
  try {
    const input = {
      text: z.string().parse(form.get("text")),
      mapping: JSON.parse(z.string().parse(form.get("mapping"))),
      fileName: form.get("fileName"),
      pageId: form.get("pageId"),
      newName: form.get("newName"),
      mode: form.get("mode"),
      requestId: form.get("requestId"),
    };
    const requestId = uuidSchema.parse(input.requestId);
    const mode = z.enum(["append", "replace", "new"]).parse(input.mode);
    const pageId = mode === "new" ? null : uuidSchema.parse(input.pageId);
    const file = z.string().trim().min(1).max(255).parse(input.fileName);
    const mapping = z
      .partialRecord(z.enum(fields), z.number().int().min(0).max(99))
      .parse(input.mapping);
    const parsed = mapRows(
      parseCsv(input.text),
      mapping,
      cleanupSchema.parse(JSON.parse(String(form.get("cleanup") || "[]"))),
    );
    const newName =
      mode === "new"
        ? z.string().trim().min(1).max(100).parse(input.newName)
        : null;
    const data = await rpc("commit_import", {
      p_request: requestId,
      p_page: pageId,
      p_new_name: newName,
      p_mode: mode,
      p_file: file,
      p_rows: parsed.valid,
      p_total: parsed.total,
      p_invalid: parsed.invalid.length,
    });
    return { data: data as unknown as ImportResult };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function fetchImportHistory(pageId: string, page = 1) {
  try {
    const { user, client } = await databaseContext();
    const id = uuidSchema.parse(pageId);
    const offset = (z.number().int().min(1).max(10000).parse(page) - 1) * 10;
    const result = await client
      .from("imports")
      .select("*")
      .eq("owner_id", user.id)
      .eq("page_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 9);
    if (result.error) throw new Error(result.error.message);
    return { data: result.data };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function undoImport(id: string): Promise<ActionResult<true>> {
  try {
    await rpc("undo_import", { p_id: uuidSchema.parse(id) });
    return { data: true };
  } catch (error) {
    return { error: message(error) };
  }
}
export async function previewImport(form: FormData): Promise<
  ActionResult<{
    total: number;
    valid: number;
    invalid: { row: number; message: string }[];
    duplicates: number;
  }>
> {
  try {
    const text = z.string().parse(form.get("text"));
    const mapping = z
      .partialRecord(z.enum(fields), z.number().int().min(0).max(99))
      .parse(JSON.parse(z.string().parse(form.get("mapping"))));
    const parsed = mapRows(
      parseCsv(text),
      mapping,
      cleanupSchema.parse(JSON.parse(String(form.get("cleanup") || "[]"))),
    );
    const duplicates = await rpc("preview_import", {
      p_urls: parsed.valid.map((r) => r.google_maps_url || null),
    });
    return {
      data: {
        total: parsed.total,
        valid: parsed.valid.length,
        invalid: parsed.invalid,
        duplicates: Number(duplicates),
      },
    };
  } catch (error) {
    return { error: message(error) };
  }
}
