import type { MappingSuggestion } from "@/lib/ai/contracts";
import { mapRows, type parseCsv } from "./csv";
export function automaticReadiness(
  csv: ReturnType<typeof parseCsv>,
  suggestion: MappingSuggestion,
) {
  if (suggestion.confidence !== "high")
    return "Column mapping needs your review.";
  if (suggestion.mapping.business_name === undefined)
    return "Choose the business name column.";
  for (const [field, index] of Object.entries(csv.mapping))
    if (suggestion.mapping[field as keyof typeof suggestion.mapping] !== index)
      return "The AI mapping differs from a recognized header. Review it before importing.";
  const used = Object.values(suggestion.mapping);
  if (
    csv.rows.some((row) =>
      row.some(
        (value, index) =>
          !used.includes(index) &&
          (/^https?:\/\//i.test(value.trim()) ||
            /^\+?[\d\s().-]{7,}$/.test(value.trim())),
      ),
    )
  )
    return "An unmapped contact or URL column needs review.";
  if (
    csv.rows.some(
      (row) => !/[\p{L}]/u.test(row[suggestion.mapping.business_name!] ?? ""),
    )
  )
    return "Business names need review.";
  const preview = mapRows(csv, suggestion.mapping, suggestion.cleanup, true);
  if (preview.invalid.length || !preview.valid.length)
    return "Some rows need review. Your file is preserved.";
  if (
    preview.valid.some((r) =>
      ["not_interested", "follow_up", "meeting_booked"].includes(r.status),
    )
  )
    return "Rejected or scheduled statuses require your confirmation.";
  return null;
}
