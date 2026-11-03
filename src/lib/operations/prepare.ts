import "server-only";
import { requireUser } from "@/lib/auth/session";
import { operationSchema } from "./contracts";

// Legacy Phase 2 validation adapter. The live Phase 6 executor is in lib/ai/assistant-actions.ts.
// This adapter intentionally validates only and must not be used to execute AI plans.
// Permission mode will be read from DB settings by a future executor, never trusted from AI input.
export async function prepareControlledOperation(input: unknown) {
  const user = await requireUser();
  const command = operationSchema.parse(input);
  return { ownerId: user.id, command, executable: false as const };
}
