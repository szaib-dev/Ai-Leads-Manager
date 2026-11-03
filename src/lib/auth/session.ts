import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const getVerifiedUser = cache(async () => {
  if (!getSupabaseConfig()) return null;
  const client = await createClient();
  // Auth-server user verification. Never authorize from a cookie payload or getSession() alone.
  try {
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user;
  } catch {
    return null;
  }
});

export async function requireUser() {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  return user;
}
