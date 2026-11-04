import { z } from "zod";
export const relevanceSchema = z
  .object({
    criteria: z.string().min(1).max(1000),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    sources: z.array(z.string().url().max(4096)).max(3).optional(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            expected: z.string(),
            name: z.string().max(300),
            classification: z.enum(["relevant", "irrelevant", "uncertain"]),
            reason: z.string().max(240),
            evidence: z.string().max(160),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type Relevance = z.infer<typeof relevanceSchema>;
export const classificationOutput = z
  .object({
    items: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(9),
            classification: z.enum(["relevant", "irrelevant", "uncertain"]),
            reason: z.string().max(240),
            evidence: z.string().max(160),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export function isRelevanceQuestion(text: string) {
  return /\b(?:irrelevant|relevant|relevance|classify|classification|suitability)\b/i.test(
    text,
  );
}
export function groundClassifications(
  raw: unknown,
  rows: {
    id: string;
    expected: string;
    name: string;
    website: string;
    notes: string;
    excerpt?: string;
  }[],
  criteria: string,
  offset: number,
  total: number,
): Relevance {
  const result = classificationOutput.parse(raw);
  if (
    result.items.length !== rows.length ||
    new Set(result.items.map((r) => r.index)).size !== rows.length ||
    result.items.some((r) => r.index >= rows.length)
  )
    throw new Error(
      "The analysis did not classify every supplied record. Retry this batch.",
    );
  return relevanceSchema.parse({
    criteria,
    offset,
    total,
    items: result.items.map((item) => {
      const row = rows[item.index];
      const supported =
        !!item.evidence.trim() &&
        [row.name, row.website, row.notes, row.excerpt ?? ""].some((value) =>
          value.toLowerCase().includes(item.evidence.toLowerCase()),
        );
      return {
        id: row.id,
        expected: row.expected,
        name: row.name,
        classification: supported ? item.classification : "uncertain",
        reason: supported
          ? item.reason
          : "Insufficient supplied evidence to support this classification.",
        evidence: supported ? item.evidence : "",
      };
    }),
  });
}
