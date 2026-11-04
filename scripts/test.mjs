import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("tests/unit")
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `tests/unit/${name}`);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit", windowsHide: true },
);
process.exit(result.status ?? 1);
