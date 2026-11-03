import { LeadWorkspace } from "@/components/leads/lead-workspace";
export const metadata = { title: "Lead workspace" };
export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadWorkspace key={id} pageId={id} />;
}
