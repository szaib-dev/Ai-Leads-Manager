import { z } from "zod";
import { importRowSchema } from "@/lib/imports/csv";
export const manualLeadSchema = z
  .object({
    pageId: z.uuid(),
    requestId: z.uuid(),
    lead: importRowSchema.extend({ status: z.literal("new") }).strict(),
  })
  .strict();
export type ManualLeadInput = z.infer<typeof manualLeadSchema>;
