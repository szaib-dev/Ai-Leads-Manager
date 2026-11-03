import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getVerifiedUser } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/auth/return-to";
import { getSupabaseConfig } from "@/lib/supabase/config";
export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeReturnTo((await searchParams).next);
  if (await getVerifiedUser()) redirect(next);
  return <LoginForm next={next} configured={!!getSupabaseConfig()} />;
}
