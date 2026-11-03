export function safeReturnTo(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length > 2048 ||
    /[\\\u0000-\u0020]/.test(input)
  )
    return "/dash";
  try {
    const decoded = decodeURIComponent(input);
    if (/[\\\u0000-\u0020]/.test(decoded)) return "/dash";
    const url = new URL(input, "https://folio.invalid");
    if (
      url.origin !== "https://folio.invalid" ||
      !/^\/dash(?:\/|$)/.test(url.pathname)
    )
      return "/dash";
    return url.pathname + url.search;
  } catch {
    return "/dash";
  }
}
