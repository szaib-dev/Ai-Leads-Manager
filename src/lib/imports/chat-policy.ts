import type { Mapping, parseCsv } from "./csv";
type Page = { id: string; name: string };
export interface ImportDestination {
  pageId?: string;
  newName: string;
  mode: "new" | "append";
  reason: string;
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function chatImportDestination(
  csv: ReturnType<typeof parseCsv>,
  mapping: Mapping,
  fileName: string,
  pages: Page[],
  currentPage?: string,
): ImportDestination {
  if (currentPage) {
    const page = pages.find((p) => p.id === currentPage);
    if (!page)
      throw new Error(
        "The selected page is unavailable. Choose another destination.",
      );
    return {
      pageId: page.id,
      newName: "",
      mode: "append",
      reason: `Using your selected context: ${page.name}`,
    };
  }
  const stem =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .slice(0, 100) || "Imported leads";
  const fileMatches = pages.filter(
    (p) => normalize(p.name) === normalize(stem),
  );
  if (fileMatches.length === 1)
    return {
      pageId: fileMatches[0].id,
      newName: "",
      mode: "append",
      reason: "The filename matches an existing page.",
    };
  const values =
    mapping.country === undefined
      ? []
      : csv.rows
          .map((row) => (row[mapping.country!] ?? "").trim())
          .filter(Boolean);
  const countries = [...new Set(values.map(normalize))];
  if (countries.length === 1 && values.length === csv.rows.length) {
    const matches = pages.filter((p) => normalize(p.name) === countries[0]);
    if (matches.length === 1)
      return {
        pageId: matches[0].id,
        newName: "",
        mode: "append",
        reason: "Every supplied country matches this existing page.",
      };
    if (matches.length === 0)
      return {
        newName: values[0].slice(0, 100),
        mode: "new",
        reason: "Creating a page from the country supplied in every CSV row.",
      };
  }
  return {
    newName: stem,
    mode: "new",
    reason:
      "Creating a page from the uploaded filename; no unambiguous existing page matched.",
  };
}
