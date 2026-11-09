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
      !(/^\/dash(?:\/|$)/.test(url.pathname) ||
        (url.pathname === "/oauth/consent" && [...url.searchParams.keys()].length === 1 && /^[A-Za-z0-9_-]{1,256}$/.test(url.searchParams.get("authorization_id") || "")) ||
        url.pathname === "/oauth/connections")
    )
      return "/dash";
    return url.pathname + url.search;
  } catch {
    return "/dash";
  }
}
