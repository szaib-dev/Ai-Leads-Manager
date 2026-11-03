import "server-only";
import { databaseContext, checkDatabaseError } from "@/lib/db/context";
import { uuidSchema } from "@/lib/validation/domain";

// Recheck immediately before outreach. This guard never deletes or deduplicates a lead.
export async function assertOutreachAllowed(leadId: string) {
  const id = uuidSchema.parse(leadId);
  const { user, client } = await databaseContext();
  const lead = await client
    .from("leads")
    .select("id,status,archived_at,deleted_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  checkDatabaseError(lead.error);
  if (
    !lead.data ||
    lead.data.deleted_at ||
    lead.data.archived_at ||
    lead.data.status === "not_interested"
  )
    throw new Error("Outreach is not allowed for this lead.");
  const suppression = await client.rpc("is_lead_suppressed", { p_lead_id: id });
  checkDatabaseError(suppression.error);
  if (suppression.data)
    throw new Error(
      "Do-not-call match: outreach is blocked. Correct an accidental rejection through lead history.",
    );
  return { leadId: id };
}
