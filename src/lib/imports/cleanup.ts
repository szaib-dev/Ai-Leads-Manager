import { z } from "zod";
export const cleanupSchema = z
  .array(z.enum(["trim_outer_whitespace", "normalize_phone_spacing"]))
  .max(2)
  .default([]);
export type Cleanup = z.infer<typeof cleanupSchema>;
export function cleanCell(
  field: string,
  value: string,
  cleanup: Cleanup,
): string {
  if (field === "google_maps_url" || field === "notes") return value;
  if (cleanup.includes("trim_outer_whitespace")) value = value.trim();
  if (field === "phone" && cleanup.includes("normalize_phone_spacing"))
    value = value.replace(/\s+/g, " ");
  return value;
}
