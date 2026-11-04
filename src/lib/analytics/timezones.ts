import countries from "./timezone-countries.json";
import { validTimeZone } from "./contracts";
const names = new Intl.DisplayNames(["en"], { type: "region" });
export function timezoneLabel(zone: string, at = new Date()) {
  const city =
    zone === "UTC"
      ? "UTC"
      : zone.split("/").slice(1).join(" / ").replaceAll("_", " ");
  const code = countries[zone as keyof typeof countries];
  const country = code ? names.of(code) : "";
  const offset =
    new Intl.DateTimeFormat("en", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "UTC") ?? "UTC";
  return `${city}${country ? `, ${country}` : ""} (${offset})`;
}
export function timezoneOptions(current: string) {
  return [...new Set(["UTC", ...Object.keys(countries), current])]
    .filter(validTimeZone)
    .map((value) => ({ value, label: timezoneLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
export function searchTimezones(
  options: { value: string; label: string }[],
  query: string,
) {
  const terms = query.toLowerCase().trim().split(/\s+/);
  return options.filter((option) =>
    terms.every((term) =>
      `${option.value.replaceAll("_", " ")} ${option.label}`
        .toLowerCase()
        .includes(term),
    ),
  );
}
