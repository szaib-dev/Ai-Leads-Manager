import { cleanCell, type Cleanup } from "./cleanup";
import Papa from "papaparse";
import { z } from "zod";
import { mapsUrlSchema, dbLeadStatusSchema } from "@/lib/validation/domain";

export const MAX_CSV_BYTES = 3_500_000;
export const fields = [
  "business_name",
  "phone",
  "website_url",
  "google_maps_url",
  "country",
  "location",
  "notes",
  "status",
] as const;
export type ImportField = (typeof fields)[number];
export type Mapping = Partial<Record<ImportField, number>>;
export function csvForm(
  text: string,
  mapping: Mapping,
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  form.set("text", text);
  form.set("mapping", JSON.stringify(mapping));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}
export const labels: Record<ImportField, string> = {
  business_name: "Business name",
  phone: "Phone number",
  website_url: "Website",
  google_maps_url: "Google Maps URL",
  country: "Country",
  location: "City / address",
  notes: "Notes",
  status: "Status",
};
const aliases: Record<ImportField, string[]> = {
  business_name: [
    "businessname",
    "name",
    "business",
    "company",
    "companyname",
    "title",
  ],
  phone: ["phone", "phonenumber", "telephone", "mobile", "contactnumber"],
  website_url: ["website", "websiteurl", "site", "url", "domain"],
  google_maps_url: [
    "googlemapsurl",
    "googlemaps",
    "mapsurl",
    "mapslink",
    "googlemapslink",
    "googleurl",
    "locationurl",
  ],
  country: ["country", "countryname"],
  location: ["location", "city", "address", "fulladdress"],
  notes: ["notes", "note", "description", "comments"],
  status: ["status", "leadstatus"],
};
export function parseCsv(text: string) {
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES)
    throw new Error("CSV exceeds 3.5 MB. Split it into smaller files.");
  if (text.includes("\0"))
    throw new Error("Unsupported binary file. Choose a UTF-8 CSV.");
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  if (result.errors.some((e) => e.type === "Quotes"))
    throw new Error(
      "Malformed CSV quotes. Export the file as UTF-8 CSV and try again.",
    );
  const [headers, ...rows] = result.data;
  if (!headers?.length || headers.length > 100)
    throw new Error("CSV must include a header row with at most 100 columns.");
  if (!rows.length || rows.length > 10000)
    throw new Error("Choose a CSV with 1–10,000 data rows.");
  const mapping: Mapping = {};
  for (const field of fields) {
    const index = headers.findIndex((h) =>
      aliases[field].includes(h.toLowerCase().replace(/[^a-z0-9]/g, "")),
    );
    if (index >= 0) mapping[field] = index;
  }
  return {
    headers: headers.map((h, i) => h.trim() || `Column ${i + 1}`),
    rows,
    mapping,
  };
}
const optionalUrl = z
  .string()
  .refine(
    (v) =>
      v === "" || (/^https?:\/\//i.test(v) && z.url().safeParse(v).success),
    "Use a complete http(s) URL",
  );
function isMapsLink(value: string) {
  if (!mapsUrlSchema.safeParse(value).success) return false;
  const { hostname, pathname } = new URL(value);
  if (hostname === "maps.app.goo.gl" || hostname === "g.page") return true;
  if (hostname === "goo.gl") return pathname.startsWith("/maps/");
  return (
    /^(maps\.|www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(
      hostname,
    ) &&
    (hostname.startsWith("maps.") || /^\/maps(?:\/|$)/.test(pathname))
  );
}
export const importRowSchema = z.object({
  business_name: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(80),
  website_url: optionalUrl.refine(
    (v) => new TextEncoder().encode(v).length <= 4096,
  ),
  google_maps_url: z
    .string()
    .refine(
      (v) => v === "" || isMapsLink(v),
      "Use an unchanged Google Maps URL (maximum 2048 UTF-8 bytes)",
    ),
  country: z.string().trim().max(100),
  location: z.string().trim().max(300),
  notes: z.string().refine((v) => new TextEncoder().encode(v).length <= 16000),
  status: dbLeadStatusSchema,
});
export type ImportRow = z.infer<typeof importRowSchema>;
const statusAliases: Record<string, string> = {
  "no answer": "no_answer",
  "not interested": "not_interested",
  "follow-up": "follow_up",
  "follow up": "follow_up",
  "callback requested": "follow_up",
  "meeting booked": "meeting_booked",
};
export function mapRows(
  csv: ReturnType<typeof parseCsv>,
  mapping: Mapping,
  cleanup: Cleanup = [],
  preserveExtra = false,
) {
  if (mapping.business_name === undefined)
    throw new Error("Map the Business name column before importing.");
  const used = Object.values(mapping);
  if (
    new Set(used).size !== used.length ||
    used.some((i) => !Number.isInteger(i) || i < 0 || i >= csv.headers.length)
  )
    throw new Error("Map each CSV column to only one field.");
  const valid: ImportRow[] = [],
    invalid: { row: number; message: string }[] = [];
  let cleanedCells = 0;
  csv.rows.forEach((row, index) => {
    if (row.length !== csv.headers.length) {
      invalid.push({
        row: index + 2,
        message: "Column count differs from the header",
      });
      return;
    }
    const values = Object.fromEntries(
      fields.map((f) => [
        f,
        mapping[f] === undefined ? "" : (row[mapping[f]!] ?? ""),
      ]),
    ) as Record<ImportField, string>;
    for (const field of fields) {
      const before = values[field];
      values[field] = cleanCell(field, before, cleanup);
      if (before !== values[field]) cleanedCells++;
    }
    if (preserveExtra) {
      const extra = csv.headers
        .flatMap((header, i) =>
          used.includes(i) || !row[i]?.trim() ? [] : [`${header}: ${row[i]}`],
        )
        .join("\n");
      if (extra)
        values.notes = [values.notes, extra].filter(Boolean).join("\n");
    }
    const rawStatus = values.status.trim().toLowerCase();
    values.status = statusAliases[rawStatus] || rawStatus || "new";
    // Only genuinely blank Maps cells become NULL later. Nonblank original URLs are never changed.
    if (!values.google_maps_url.trim()) values.google_maps_url = "";
    const parsed = importRowSchema.safeParse(values);
    if (parsed.success) valid.push(parsed.data);
    else
      invalid.push({
        row: index + 2,
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  });
  return { valid, invalid, total: csv.rows.length, cleanedCells };
}
