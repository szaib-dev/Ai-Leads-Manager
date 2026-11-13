// Test tooling only. Keys stay in process memory, never in source, output, or environment files.
import { spawnSync } from "node:child_process";
let cachedKey;
export function testAdminKey() {
  if(cachedKey)return cachedKey;
  const r = spawnSync(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      "npx --yes supabase@3.1.0 projects api-keys --remote=lypfxcohmsosedwptebu --reveal --output json",
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 1000000 },
  );
  if (r.status !== 0)
    throw new Error(
      "Administrative API-key access unavailable; no key contents were logged.",
    );
  let body;
  try {
    body = JSON.parse(r.stdout);
  } catch {
    throw new Error("Administrative key response not JSON; contents withheld.");
  }
  const values = [];
  function visit(v) {
    if (typeof v === "string") values.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  }
  visit(body);
  const key =
    values.find((v) => v.startsWith("sb_secret_")) ||
    values.find((v) => {
      try {
        return (
          JSON.parse(Buffer.from(v.split(".")[1] || "", "base64url").toString())
            .role === "service_role"
        );
      } catch {
        return false;
      }
    });
  if (!key)
    throw new Error("No administrative key available; contents withheld.");
  cachedKey=key;
  return key;
}
