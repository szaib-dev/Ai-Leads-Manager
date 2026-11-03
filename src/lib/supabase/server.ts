import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { getSupabaseConfig } from "./config";

// Always create a request-scoped client. Never cache a user's client globally.
export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase has not been configured.");
  const store = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    cookieOptions: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies. Proxy refreshes them before rendering. Actions can write. */
        }
      },
    },
  });
}
