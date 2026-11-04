import { z } from "zod";
import { fields } from "@/lib/imports/csv";
import { cleanupSchema } from "@/lib/imports/cleanup";
export const sampleSchema = z
  .object({
    headers: z.array(z.string().max(160)).min(1).max(100),
    rows: z.array(z.array(z.string().max(80)).max(100)).max(3),
  })
  .strict();
export type CsvSample = z.infer<typeof sampleSchema>;
export const suggestionSchema = z
  .object({
    mapping: z.partialRecord(z.enum(fields), z.number().int().min(0).max(99)),
    cleanup: cleanupSchema,
    explanation: z.string().max(600),
    confidence: z.enum(["high", "review"]).optional(),
  })
  .strict();
export type MappingSuggestion = z.infer<typeof suggestionSchema>;
export function csvSample(csv: {
  headers: string[];
  rows: string[][];
}): CsvSample {
  return {
    headers: csv.headers.map((h) => h.slice(0, 160)),
    rows: csv.rows
      .slice(0, 3)
      .map((r) => r.slice(0, csv.headers.length).map((c) => c.slice(0, 80))),
  };
}
export function validateSuggestion(
  raw: unknown,
  columnCount: number,
): MappingSuggestion {
  const s = suggestionSchema.parse(raw);
  const indices = Object.values(s.mapping);
  if (
    indices.some((i) => i >= columnCount) ||
    new Set(indices).size !== indices.length
  )
    throw new Error("AI suggested an invalid or ambiguous mapping.");
  return s;
}
