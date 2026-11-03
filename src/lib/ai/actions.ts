"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
import {
  sampleSchema,
  type CsvSample,
  type MappingSuggestion,
} from "./contracts";
import { aiConfigured, aiServerToken } from "./config";
import { buildMessages, requestMapping, type ProviderUsage } from "./deepseek";
import type { ActionResult } from "@/lib/leads/contracts";
export async function autoMapCsv(
  input: CsvSample,
  requestId: string,
): Promise<ActionResult<MappingSuggestion>> {
  let reserved = false,
    usage: ProviderUsage | undefined;
  const { client } = await databaseContext();
  try {
    z.uuid().parse(requestId);
    const sample = sampleSchema.parse(input);
    if (!aiConfigured()) throw new Error("DeepSeek is not configured.");
    const bound =
      Buffer.byteLength(JSON.stringify(buildMessages(sample))) + 1024;
    const r = await client.rpc("ai_csv_reserve", {
      p_request: requestId,
      p_input_bound: bound,
      p_server_token: aiServerToken(),
    } as never);
    if (r.error) throw new Error(r.error.message);
    reserved = true;
    const result = await requestMapping(sample);
    usage = result.usage;
    return { data: result.suggestion };
  } catch (e) {
    if (e && typeof e === "object" && "usage" in e)
      usage = e.usage as ProviderUsage;
    return {
      error: `${e instanceof Error ? e.message : "AI assistance failed."} Manual mapping and importing remain available.`,
    };
  } finally {
    if (reserved) {
      const settled = await client.rpc("ai_csv_settle", {
        p_request: requestId,
        p_input: usage?.input ?? null,
        p_output: usage?.output ?? null,
        p_server_token: aiServerToken(),
      } as never);
      if (settled.error)
        console.error(
          "AI usage settlement failed; conservative reservation remains charged.",
        );
    }
  }
}
