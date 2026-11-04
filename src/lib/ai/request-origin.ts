// Next.js may normalize the internal URL host behind a proxy. Authorize the public request host.
export function trustedChatOrigin(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || request.headers.get("sec-fetch-site") === "cross-site")
      return false;
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin === origin &&
      parsed.host.toLowerCase() === request.headers.get("host")?.toLowerCase()
    );
  } catch {
    return false;
  }
}
