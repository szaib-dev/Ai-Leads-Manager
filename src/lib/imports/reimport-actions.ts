"use server";
import { databaseContext } from "@/lib/db/context";
import { z } from "zod";
import type { ActionResult } from "@/lib/leads/contracts";
export async function acknowledgeReimport(
  id: string,
  expected: string,
): Promise<ActionResult<true>> {
  try {
    const { client } = await databaseContext();
    const r = await client.rpc(
      "acknowledge_reimport" as never,
      {
        p_id: z.uuid().parse(id),
        p_expected: z.iso.datetime({ offset: true }).parse(expected),
      } as never,
    );
    if (r.error) throw new Error(r.error.message);
    return { data: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not update this lead",
    };
  }
}
