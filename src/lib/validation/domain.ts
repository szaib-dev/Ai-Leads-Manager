import { z } from "zod";
export const uuidSchema = z.uuid();
export const daySchema = z.iso.date();
export const pageRequestSchema = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export const dbLeadStatusSchema = z.enum([
  "new",
  "no_answer",
  "voicemail",
  "interested",
  "not_interested",
  "follow_up",
  "meeting_booked",
]);
const urlSchema = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "HTTP(S) URLs only");
// Preserve the caller's exact URL. Reject unsupported input instead of normalizing it.
export const mapsUrlSchema = z
  .string()
  .refine(
    (value) =>
      value === value.trim() &&
      new TextEncoder().encode(value).length <= 2048 &&
      urlSchema.safeParse(value).success,
    "Maps URLs must be unchanged and at most 2048 UTF-8 bytes",
  );
export const createPageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).default(""),
  })
  .strict();
export const leadListSchema = pageRequestSchema
  .extend({
    pageId: uuidSchema.optional(),
    importId: uuidSchema.optional(),
    status: dbLeadStatusSchema.optional(),
    archive: z.boolean().default(false),
  })
  .strict();
export function pageRange(input: z.input<typeof pageRequestSchema>) {
  const value = pageRequestSchema.parse(input);
  const from = (value.page - 1) * value.pageSize;
  return { ...value, from, to: from + value.pageSize - 1 };
}
