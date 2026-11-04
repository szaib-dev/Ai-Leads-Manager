"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { parseCsv, csvForm, mapRows, fields, type Mapping } from "./csv";
import { cleanupSchema, type Cleanup } from "./cleanup";
import { automaticReadiness } from "./automatic-policy";
import { chatImportDestination, type ImportDestination } from "./chat-policy";
import { csvSample, type MappingSuggestion } from "@/lib/ai/contracts";
import { autoMapCsv } from "@/lib/ai/actions";
import { importCsv } from "@/lib/leads/actions";
import type { ActionResult, ImportResult } from "@/lib/leads/contracts";
const sourceSchema = z
  .object({
    text: z.string().max(3500000),
    fileName: z.string().trim().min(1).max(255),
    requestId: z.uuid(),
    pageId: z.uuid().optional(),
    automatic: z.boolean(),
  })
  .strict();
export type ChatImportSource = z.infer<typeof sourceSchema>;
export interface PreparedChatImport {
  suggestion?: MappingSuggestion;
  destination: ImportDestination;
  reviewReason?: string;
  result?: ImportResult;
}
export async function prepareChatImport(
  input: ChatImportSource,
): Promise<ActionResult<PreparedChatImport>> {
  try {
    const source = sourceSchema.parse(input),
      csv = parseCsv(source.text),
      { client, user } = await databaseContext();
    const existing = await client
      .from("imports")
      .select("*")
      .eq("owner_id", user.id)
      .eq("request_id", source.requestId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const pages = await client
      .from("lead_pages")
      .select("id,name")
      .eq("owner_id", user.id)
      .is("deleted_at", null);
    if (pages.error) throw new Error(pages.error.message);
    let destination = chatImportDestination(
      csv,
      csv.mapping,
      source.fileName,
      pages.data,
      source.pageId,
    );
    if (existing.data) {
      const b = existing.data;
      if (b.status !== "completed")
        throw new Error(
          "This batch was already processed. Upload the file again to start a new import.",
        );
      return {
        data: {
          destination,
          result: {
            id: b.id,
            pageId: b.page_id,
            imported: b.successful_rows,
            duplicates: b.skipped_duplicates,
            invalid: b.invalid_rows,
            replaced: b.replaced_count,
          },
        },
      };
    }
    if (!source.automatic)
      return {
        data: {
          destination,
          reviewReason:
            "Manual mode. Map columns and review the preview below.",
        },
      };
    const mapped = await autoMapCsv(csvSample(csv), crypto.randomUUID());
    if (!mapped.data)
      return {
        data: {
          destination,
          reviewReason:
            mapped.error ??
            "AI mapping is unavailable. Your file is ready for manual review.",
        },
      };
    const suggestion = mapped.data;
    destination = chatImportDestination(
      csv,
      suggestion.mapping,
      source.fileName,
      pages.data,
      source.pageId,
    );
    const reason = automaticReadiness(csv, suggestion);
    if (reason)
      return { data: { suggestion, destination, reviewReason: reason } };
    const state = await client.rpc("ai_assistant_state");
    if (state.error) throw new Error(state.error.message);
    const mode = (state.data as unknown as { mode: string }).mode;
    if (mode !== "autonomous")
      return {
        data: {
          suggestion,
          destination,
          reviewReason:
            "Mapping is ready. Your approval mode requires confirmation before importing.",
        },
      };
    const imported = await confirmChatImport({
      ...source,
      mapping: suggestion.mapping,
      cleanup: suggestion.cleanup,
      destination,
      rejectionsApproved: false,
    });
    if (imported.error)
      return {
        data: { suggestion, destination, reviewReason: imported.error },
      };
    return { data: { suggestion, destination, result: imported.data } };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "AI import unavailable; use manual mapping. Your file is preserved.",
    };
  }
}
export async function confirmChatImport(
  input: ChatImportSource & {
    mapping: Mapping;
    cleanup: Cleanup;
    destination: ImportDestination;
    rejectionsApproved: boolean;
  },
): Promise<ActionResult<ImportResult>> {
  try {
    const source = sourceSchema.parse({
      text: input.text,
      fileName: input.fileName,
      requestId: input.requestId,
      pageId: input.pageId,
      automatic: input.automatic,
    });
    const mapping = z
        .partialRecord(z.enum(fields), z.number().int().min(0).max(99))
        .parse(input.mapping),
      cleanup = cleanupSchema.parse(input.cleanup);
    const dest = z
      .object({
        pageId: z.uuid().optional(),
        newName: z.string().max(100),
        mode: z.enum(["new", "append"]),
        reason: z.string().max(300),
      })
      .strict()
      .parse(input.destination);
    const preview = mapRows(parseCsv(source.text), mapping, cleanup, true);
    if (
      preview.valid.some((r) => r.status === "not_interested") &&
      input.rejectionsApproved !== true
    )
      throw new Error(
        "Confirm the rejected-lead retention and do-not-call rule before importing.",
      );
    return await importCsv(
      csvForm(source.text, mapping, {
        cleanup: JSON.stringify(cleanup),
        preserveExtra: "true",
        requestId: source.requestId,
        fileName: source.fileName,
        pageId: dest.pageId ?? "",
        newName: dest.newName,
        mode: dest.mode,
      }),
    );
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Import failed. Your file is preserved.",
    };
  }
}
