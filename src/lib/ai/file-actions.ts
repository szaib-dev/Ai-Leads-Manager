"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import { parseCsv } from "@/lib/imports/csv";
import type { ActionResult } from "@/lib/leads/contracts";
export async function uploadChatFile(input: {
  id: string;
  conversationId: string;
  name: string;
  text: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const p = z
      .object({
        id: z.uuid(),
        conversationId: z.uuid(),
        name: z.string().min(1).max(255),
        text: z.string().max(3500000),
      })
      .strict()
      .parse(input);
    parseCsv(p.text);
    const { client } = await databaseContext();
    const r = await client.rpc(
      "store_chat_file" as never,
      {
        p_id: p.id,
        p_conversation: p.conversationId,
        p_name: p.name,
        p_text: p.text,
      } as never,
    );
    if (r.error) throw r.error;
    return { data: { id: p.id } };
  } catch {
    return {
      error:
        "Could not prepare this CSV. Check its format or retry; your file is preserved.",
    };
  }
}
