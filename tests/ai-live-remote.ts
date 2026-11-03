// Dedicated remote test. Fictional CSV sample; budget reserved before the single paid provider request.
// Server proof/provider key and temporary credentials remain in memory. Fixture account is removed.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
import { aiServerToken } from "../src/lib/ai/config";
import { requestMapping, type ProviderUsage } from "../src/lib/ai/deepseek";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const admin = createClient(url, testAdminKey(), options),
    client = createClient(url, key, options);
  let owner: string | undefined,
    reserved = false,
    usage: ProviderUsage | undefined;
  const requestId = randomUUID();
  try {
    const email = `folio-ai-mapping-${randomUUID()}@example.invalid`,
      password = randomBytes(32).toString("base64url");
    const fixture = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (fixture.error)
      throw new Error("Cannot create temporary verification account.");
    owner = fixture.data.user.id;
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw new Error("Fixture authentication failed.");
    const reserve = await client.rpc("ai_csv_reserve", {
      p_request: requestId,
      p_input_bound: 6000,
      p_server_token: aiServerToken(),
    });
    if (reserve.error)
      throw new Error(
        `AI reservation failed (${reserve.error.code}); no provider request sent.`,
      );
    reserved = true;
    const result = await requestMapping({
      headers: [
        "trading_label",
        "dial_digits",
        "home_on_the_web",
        "pin_link",
        "town",
        "nation",
        "memo",
      ],
      rows: [
        [
          "Oak Cafe",
          "+1 202 555 0123",
          "https://oak.example",
          "https://maps.google.com/?cid=fixture",
          "Austin",
          "USA",
          "Call after lunch",
        ],
      ],
    });
    usage = result.usage;
    assert.deepEqual(result.suggestion.mapping, {
      business_name: 0,
      phone: 1,
      website_url: 2,
      google_maps_url: 3,
      location: 4,
      country: 5,
      notes: 6,
    });
    console.log(
      JSON.stringify({
        liveDeepSeekMapping: true,
        inputTokens: usage.input,
        outputTokens: usage.output,
        model: "deepseek-flash",
      }),
    );
  } catch (e) {
    if (e && typeof e === "object" && "usage" in e)
      usage = e.usage as ProviderUsage;
    throw e;
  } finally {
    if (reserved) {
      const settled = await client.rpc("ai_csv_settle", {
        p_request: requestId,
        p_input: usage?.input ?? null,
        p_output: usage?.output ?? null,
        p_server_token: aiServerToken(),
      });
      if (settled.error)
        console.error("Settlement failed; reservation remains held.");
      else console.log("PASS: live usage settled in durable budget ledger");
    }
    await client.auth.signOut();
    await client.removeAllChannels();
    if (owner) {
      const removed = await admin.auth.admin.deleteUser(owner);
      if (removed.error)
        throw new Error("Temporary AI account cleanup failed.");
      console.log(
        "PASS: temporary AI account removed; anonymous cost retained",
      );
    }
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Live AI verification failed");
  process.exitCode = 1;
});
