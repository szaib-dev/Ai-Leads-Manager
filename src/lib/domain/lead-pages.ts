import "server-only";
import { databaseContext, checkDatabaseError } from "@/lib/db/context";
import { createPageSchema } from "@/lib/validation/domain";

// Internal foundation service; no action/route or feature UI calls this in Phase 2.
export async function createLeadPage(input: unknown) {
  const data = createPageSchema.parse(input);
  const { client } = await databaseContext();
  const result = await client
    .from("lead_pages")
    .insert(data)
    .select("id,name,description,created_at")
    .single();
  checkDatabaseError(result.error);
  return result.data;
}
