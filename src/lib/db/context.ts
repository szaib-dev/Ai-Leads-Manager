import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Explicit ownership filters AND RLS. Never accept an owner ID from a caller.
export async function databaseContext() {
  const user = await requireUser();
  const client = await createClient();
  return { user, client };
}
export function checkDatabaseError(error: { code?: string } | null) {
  if (error)
    throw new Error(
      error.code === "23505"
        ? "This record conflicts with an existing record."
        : "The database request could not be completed.",
    );
}
