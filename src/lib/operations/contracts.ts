import { z } from "zod";
import { dbLeadStatusSchema, uuidSchema } from "@/lib/validation/domain";
// No SQL strings, arbitrary expressions, caller-supplied owner IDs, or arbitrary table names.
const ids = z.array(uuidSchema).min(1).max(100);
export const operationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lead_bulk_status"),
      leadIds: ids,
      status: dbLeadStatusSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("lead_delete_matching"),
      importId: uuidSchema,
      withoutPhone: z.literal(true),
    })
    .strict(),
  z.object({ kind: z.literal("import_undo"), importId: uuidSchema }).strict(),
  z.object({ kind: z.literal("lead_restore"), leadIds: ids }).strict(),
  z
    .object({
      kind: z.literal("lead_update"),
      leadId: uuidSchema,
      notes: z.string().max(16000),
    })
    .strict(),
]);
export type ControlledOperation = z.infer<typeof operationSchema>;
export function requiresApproval(
  mode: "strict" | "balanced" | "autonomous",
  operation: ControlledOperation,
) {
  return (
    mode === "strict" ||
    (mode === "balanced" &&
      ["lead_delete_matching", "import_undo"].includes(operation.kind))
  );
}
