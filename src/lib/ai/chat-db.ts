import "server-only";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
export async function chatRpc<T>(
  client: SupabaseClient<Database>,
  name:
    "ai_chat_claim" | "ai_chat_finish" | "ai_chat_context" | "ai_chat_event",
  args: Record<string, unknown>,
) {
  const r = await client.rpc(name as never, args as never);
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
