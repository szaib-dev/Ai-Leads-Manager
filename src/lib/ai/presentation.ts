import { z } from "zod";
import type { AiResult } from "./assistant-contracts";
const metric = z
  .object({
    type: z.literal("metric"),
    label: z.string().max(100),
    value: z.number().int().nonnegative(),
  })
  .strict();
const chart = z
  .object({
    type: z.literal("chart"),
    title: z.string().max(100),
    bars: z
      .array(
        z
          .object({
            label: z.string().max(80),
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const imports = z
  .object({
    type: z.literal("import"),
    id: z.uuid(),
    fileName: z.string().max(255),
    imported: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    status: z.string().max(30),
  })
  .strict();
export const uiBlockSchema = z.discriminatedUnion("type", [
  metric,
  chart,
  imports,
]);
export type UiBlock = z.infer<typeof uiBlockSchema>;
// Presentation is chosen from trusted database evidence, never executable model output.
export function presentationFor(
  result: AiResult,
  instruction: string,
): UiBlock[] {
  const blocks: unknown[] = [];
  if (
    result.action === "search" &&
    /how many|count|number of|total/i.test(instruction)
  )
    blocks.push({
      type: "metric",
      label: result.scope?.pageId
        ? "Matching leads"
        : "Matching leads across all pages",
      value: result.count,
    });
  if (
    result.action === "search" &&
    /statistic|breakdown|chart|distribution|by status/i.test(instruction) &&
    result.statistics
  )
    blocks.push({
      type: "chart",
      title: "Matching leads by status",
      bars: result.statistics,
    });
  if (result.importSummary)
    blocks.push({ type: "import", ...result.importSummary });
  return z.array(uiBlockSchema).max(3).parse(blocks);
}
