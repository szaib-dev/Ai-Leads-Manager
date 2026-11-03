import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
const [pgBin, database] = process.argv.slice(2);
assert.match(
  database,
  /^folio_test_[a-f0-9]{32}$/,
  "Concurrency test requires a newly named scratch database",
);
const executable = join(
  pgBin,
  process.platform === "win32" ? "psql.exe" : "psql",
);
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
function sql(query) {
  const result = spawnSync(executable, [...args, "-c", query], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
sql(`insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
insert into public.lead_pages(id,owner_id,name) values
('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Concurrent page one'),
('a0000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Concurrent page two');`);
const auth = `begin;set local statement_timeout='10s';set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);`;
const first = spawn(
  executable,
  [
    ...args,
    "-c",
    `${auth}
set local application_name='folio_concurrent_first';
insert into public.leads(page_id,business_name,google_maps_url,notes) values('a0000000-0000-4000-8000-000000000001','First writer','https://www.google.com/maps?cid=concurrency','Original concurrent notes');
select pg_sleep(3);commit;`,
  ],
  { windowsHide: true },
);
let errors = "";
first.stdout.on("data", () => {});
first.stderr.on("data", (chunk) => {
  errors += chunk;
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
      "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and a.application_name='folio_concurrent_first' and l.locktype='advisory' and l.granted)",
    ) !== "t"
  ) {
    assert.ok(
      first.exitCode === null && Date.now() < deadline,
      "First writer must hold a live transaction lock",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const waitStarted = performance.now();
  // This statement starts while the original is uncommitted and has an older outer query snapshot.
  sql(`${auth}insert into public.leads(page_id,business_name,google_maps_url,notes)
  values('a0000000-0000-4000-8000-000000000002','Concurrent upsert','https://www.google.com/maps?cid=concurrency','Overwritten')
  on conflict(owner_id,google_maps_url) where google_maps_url is not null do update set notes=excluded.notes;commit;`);
  assert.ok(
    performance.now() - waitStarted >= 1000,
    "The second INSERT must actually wait for the original transaction, not run after commit",
  );
  await finished;
  assert.equal(
    sql(
      "select count(*)=1 and bool_and(notes='Original concurrent notes' and status='new' and archived_at is null) from public.leads where google_maps_url='https://www.google.com/maps?cid=concurrency'",
    ),
    "t",
  );
  console.log(
    "PASS: concurrent cross-page upsert waits, skips the duplicate, and preserves the original",
  );
} finally {
  if (first.exitCode === null) first.kill();
}
