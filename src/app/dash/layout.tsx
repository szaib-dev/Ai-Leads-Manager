import { AppShell } from "@/components/dashboard/app-shell";
import { Providers } from "@/components/providers";
import { requireUser } from "@/lib/auth/session";
import { fetchWorkspaceState } from "@/lib/leads/actions";
// Bounded AI planning plus transactional bulk execution on Vercel Fluid Compute.
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const result = await fetchWorkspaceState();
  if (!result.data) throw new Error(result.error);
  return (
    <Providers
      key={user.id}
      initialRealPages={result.data.pages}
      ownerId={user.id}
      initialRevision={result.data.revision}
    >
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
