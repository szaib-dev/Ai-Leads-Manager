export interface SupabaseConfig {
  url: string;
  key: string;
}

export function validateSupabaseConfig(
  url?: string,
  key?: string,
): SupabaseConfig | null {
  if (key?.startsWith("sb_secret_"))
    throw new Error(
      "A secret Supabase key must never be used as a public key.",
    );
  if (key && !key.startsWith("sb_publishable_")) {
    try {
      const claims = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (claims.role !== "anon") throw new Error("Not an anon key");
    } catch {
      throw new Error(
        "Use a publishable key or legacy anon key, never a service-role key.",
      );
    }
  }
  if (!url || !key) return null;
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "Use the Supabase project origin without credentials, path, query or fragment.",
    );
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new Error("Supabase URL must use HTTPS (except local development).");
  return { url: parsed.origin, key };
}

export function getSupabaseConfig() {
  return validateSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
