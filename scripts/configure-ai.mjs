// Private setup helper, dedicated project only. Never writes the API key or derived server proof.
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
const ref = "lypfxcohmsosedwptebu";
if (
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
  `${ref}.supabase.co`
)
  throw new Error("Unexpected project URL; configuration stopped.");
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error("Set DEEPSEEK_API_KEY privately in .env.local.");
const hash = createHash("sha256")
  .update(createHmac("sha256", key).update("folio-ai-server-v1").digest("hex"))
  .digest("hex");
const budget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 1.75),
  input = Number(process.env.AI_INPUT_USD_PER_MILLION ?? 0.3),
  output = Number(process.env.AI_OUTPUT_USD_PER_MILLION ?? 1.2),
  date = process.env.AI_PRICING_VERIFIED_DATE;
if (
  ![budget, input, output].every((n) => Number.isFinite(n) && n > 0) ||
  budget > 2 ||
  (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
)
  throw new Error("Invalid budget/pricing configuration. Set AI_PRICING_VERIFIED_DATE to the date you actually reviewed provider pricing.");
mkdirSync(".local-test-output", { recursive: true });
const path = ".local-test-output/configure-ai.sql";
writeFileSync(
  path,
  `update private.ai_runtime set server_token_hash=decode('${hash}','hex'),monthly_budget=${budget},input_rate=${input},output_rate=${output},pricing_verified='${date}'::date,pricing_reviewed_at='${date}'::timestamp at time zone 'Asia/Karachi' where singleton;`,
);
try {
  const r = spawnSync(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      `npx --offline supabase@3.0.0 db query --remote=${ref} --file ${path} --yes`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (r.status !== 0)
    throw new Error(
      "Remote AI configuration failed. Check CLI project access; credential contents withheld.",
    );
  console.log(
    `AI budget configured on ${ref}: $${budget}/month; pricing verified ${date}. No provider key stored in the database.`,
  );
} finally {
  unlinkSync(path);
}
