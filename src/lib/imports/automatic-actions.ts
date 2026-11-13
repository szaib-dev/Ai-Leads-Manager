"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { importPreferences } from "./preferences";
import { parseCsv, csvForm } from "./csv";
import { automaticReadiness } from "./automatic-policy";
import { csvSample, type MappingSuggestion } from "@/lib/ai/contracts";
import { autoMapCsv } from "@/lib/ai/actions";
import { importCsv } from "@/lib/leads/actions";
import type { ActionResult, ImportResult } from "@/lib/leads/contracts";
export async function prepareCsvImport(input: {
  text: string;
  fileName: string;
  pageId?: string;
  countryId?: string;
  cityId?: string;
  requestId: string;
  mode: "new" | "append" | "replace";
  newName: string;
}): Promise<
  ActionResult<{
    mode: "manual" | "automatic";
    result?: ImportResult;
    suggestion?: MappingSuggestion;
    reviewReason?: string;
  }>
> {
  try {
    input = z
      .object({
        text: z.string().max(3500000),
        fileName: z.string().trim().min(1).max(255),
        pageId: z.uuid().optional(),
        countryId: z.uuid().optional(),
        cityId: z.uuid().optional(),
        requestId: z.uuid(),
        mode: z.enum(["new", "append", "replace"]),
        newName: z.string().max(100),
      })
      .strict()
      .parse(input);
    const { client, user } = await databaseContext();
    const request = z.uuid().parse(input.requestId);
    const csv = parseCsv(input.text);
    const existing = await client
      .from("imports")
      .select("*")
      .eq("owner_id", user.id)
      .eq("request_id", request)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.status === "completed") {
      const b = existing.data;
      return {
        data: {
          mode: "automatic",
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
    const preference = await importPreferences();
    if (!preference.data) throw new Error(preference.error);
    if (preference.data.mode === "manual") return { data: { mode: "manual" } };
    const mapped = await autoMapCsv(csvSample(csv), request);
    if (!mapped.data)
      return {
        data: {
          mode: "manual",
          reviewReason: mapped.error ?? "Mapping is unavailable",
        },
      };
    const suggestion = mapped.data;
    const reason = automaticReadiness(csv, suggestion);
    if (reason || input.mode === "replace")
      return {
        data: {
          mode: "manual",
          suggestion,
          reviewReason:
            reason ?? "Replacement always requires explicit review.",
        },
      };
    const latest = await importPreferences();
    if (latest.data?.mode !== "automatic")
      return {
        data: {
          mode: "manual",
          suggestion,
          reviewReason:
            "Automatic importing is disabled. Review the mapped file below.",
        },
      };
    const result = await importCsv(
      csvForm(input.text, suggestion.mapping, {
        cleanup: JSON.stringify(suggestion.cleanup),
        preserveExtra: "true",
        requestId: request,
        fileName: input.fileName,
        mode: input.mode,
        pageId: input.pageId ?? "",
        countryId: input.countryId ?? "",
        cityId: input.cityId ?? "",
        newName: input.newName,
      }),
    );
    if (result.error)
      return {
        data: { mode: "manual", suggestion, reviewReason: result.error },
      };
    return { data: { mode: "automatic", result: result.data } };
  } catch (e) {
    return {
      error: `${e instanceof Error ? e.message : "Automatic import unavailable"}. Use the manual importer below; your file is preserved.`,
    };
  }
}
