import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
const [pgBin, database] = process.argv.slice(2);
assert.match(database, /^folio_test_[a-f0-9]{32}$/);
const exe = join(pgBin, process.platform === "win32" ? "psql.exe" : "psql");
const args = [
  "-X",
  "-q",
  "-A",
  "-t",
  "-h",
  "127.0.0.1",
  "-p",
  "55432",
  "-U",
  "phase2_test",
  "-d",
  database,
  "-v",
  "ON_ERROR_STOP=1",
];
function result(q) {
  return spawnSync(exe, [...args, "-c", q], {
    encoding: "utf8",
    windowsHide: true,
  });
}
function sql(q) {
  const r = result(q);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const owner = "70000000-0000-4000-8000-000000000007",
  page = "a7000000-0000-4000-8000-000000000007",
  lead = "b7000000-0000-4000-8000-000000000007";
sql(
  `insert into auth.users(id)values('${owner}');insert into public.lead_pages(id,owner_id,name)values('${page}','${owner}','Call concurrency');insert into public.leads(id,owner_id,page_id,business_name)values('${lead}','${owner}','${page}','Concurrent call');`,
);
const auth = `begin;set local statement_timeout='10s';set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);`;
async function concurrent(requestOne, requestTwo, retry) {
  const stamp = sql(`select updated_at from public.leads where id='${lead}'`);
  const call = (req) =>
    `select public.record_call('${lead}','${stamp}','${req}','${retry ? "no_answer" : "interested"}','Confirmed');`;
  const first = spawn(
    exe,
    [
      ...args,
      "-c",
      `${auth}set local application_name='folio_calls_first';${call(requestOne)}select pg_sleep(2);commit;`,
    ],
    { windowsHide: true },
  );
  let errors = "";
  first.stdout.on("data", () => {});
  first.stderr.on("data", (b) => {
    errors += b;
  });
  const finished = new Promise((resolve, reject) => {
    first.on("error", reject);
    first.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(errors)),
    );
  });
  finished.catch(() => {});
  try {
    const deadline = Date.now() + 10000;
    while (
      sql(
        "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and a.application_name='folio_calls_first' and l.locktype='advisory' and l.granted)",
      ) !== "t"
    ) {
      assert.ok(first.exitCode === null && Date.now() < deadline);
      await new Promise((r) => setTimeout(r, 25));
    }
    const second = result(`${auth}${call(requestTwo)}commit;`);
    await finished;
    if (retry) assert.equal(second.status, 0, second.stderr);
    else {
      assert.notEqual(second.status, 0);
      assert.match(second.stderr, /Lead changed/);
    }
  } finally {
    if (first.exitCode === null) first.kill();
  }
}
await concurrent(
  "c7000000-0000-4000-8000-000000000007",
  "c7000000-0000-4000-8000-000000000007",
  true,
);
assert.equal(
  sql(`select count(*)=1 from public.call_attempts where lead_id='${lead}'`),
  "t",
);
assert.equal(
  sql(
    `select count(*)=1 from public.activity_events where lead_id='${lead}' and kind='call_attempt'`,
  ),
  "t",
);
console.log(
  "PASS: concurrent confirmation retries create exactly one attempt and one historical call fact",
);
await concurrent(
  "d7000000-0000-4000-8000-000000000007",
  "e7000000-0000-4000-8000-000000000007",
  false,
);
assert.equal(
  sql(`select count(*)=2 from public.call_attempts where lead_id='${lead}'`),
  "t",
);
assert.equal(
  sql(
    `select status='interested' and archived_at is null from public.leads where id='${lead}'`,
  ),
  "t",
);
console.log(
  "PASS: concurrent distinct confirmations reject the stale writer and preserve successful workflow",
);
