"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import type { ActionResult } from "@/lib/leads/contracts";
export type ImportMode = "manual" | "automatic";
export async function importPreferences(): Promise<
  ActionResult<{ mode: ImportMode }>
> {
  try {
    const { client } = await databaseContext();
    const r = await client.rpc("import_preferences" as never);
    if (r.error) throw new Error(r.error.message);
    return {
      data: z.object({ mode: z.enum(["manual", "automatic"]) }).parse(r.data),
    };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not load import preference",
    };
  }
}
export async function saveImportMode(
  mode: ImportMode,
): Promise<ActionResult<true>> {
  try {
    const { client } = await databaseContext();
    const value = z.enum(["manual", "automatic"]).parse(mode);
    const r = await client.rpc(
      "set_import_mode" as never,
      { p_mode: value } as never,
    );
    if (r.error) throw new Error(r.error.message);
    return { data: true };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not save import preference",
    };
  }
}
