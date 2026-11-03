"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { loginSchema } from "@/lib/validation/auth";
import { safeReturnTo } from "./return-to";

export interface LoginState {
  error: string;
}
export async function login(
  _previous: LoginState,
  form: FormData,
): Promise<LoginState> {
  if (!getSupabaseConfig())
    return {
      error:
        "The workspace needs Supabase configuration before you can sign in.",
    };
  const input = loginSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!input.success) return { error: "Enter a valid email and password." };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error)
    return {
      error: "Unable to sign in. Check your credentials and try again shortly.",
    };
  redirect(safeReturnTo(form.get("next")));
}

export async function logout(): Promise<never> {
  const config = getSupabaseConfig();
  if (config) {
    const client = await createClient();
    // Local scope revokes this session's refresh tokens, without signing out other devices.
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      /* Still clear this browser's credentials when the auth network is unavailable. */
    }
    // Always remove this project's local cookies, including when Auth is unavailable.
    const store = await cookies();
    const prefix = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    store
      .getAll()
      .filter(
        (cookie) =>
          cookie.name === prefix || cookie.name.startsWith(`${prefix}.`),
      )
      .forEach((cookie) =>
        store.set(cookie.name, "", { path: "/", maxAge: 0 }),
      );
  }
  redirect("/login");
}
