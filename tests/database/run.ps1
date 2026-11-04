param([string]$PgBin = 'C:/Program Files/PostgreSQL/18/bin')
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cluster = Join-Path $workspace '.local-postgres'
$database = 'folio_test_' + [guid]::NewGuid().ToString('N')
# Only an owned scratch cluster and a freshly named disposable database are touched.
if (!(Test-Path (Join-Path $cluster 'PG_VERSION'))) {
  & (Join-Path $PgBin 'initdb.exe') -D $cluster -U phase2_test -A trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Scratch initdb failed' }
}
& (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p 55432 *> $null
$started = $LASTEXITCODE -ne 0
if ($started) {
  & (Join-Path $PgBin 'pg_ctl.exe') -D $cluster -l (Join-Path $cluster 'server.log') -o '-p 55432 -h 127.0.0.1 -c timezone=UTC' -w start
  if ($LASTEXITCODE -ne 0) { throw 'Scratch PostgreSQL startup failed' }
}
try {
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U phase2_test $database
  if ($LASTEXITCODE -ne 0) { throw 'Scratch database creation failed' }
  $migrations = @(Get-ChildItem (Join-Path $workspace 'supabase/migrations/*.sql') | Sort-Object Name)
  # Verify the Phase 2/3 grants as they existed, then test the stricter Phase 4 RPC-only workflows.
  $files = @((Join-Path $PSScriptRoot 'bootstrap.sql')) + @($migrations | Where-Object Name -LT '202611030004' | ForEach-Object FullName) + @((Join-Path $PSScriptRoot 'security.sql'),(Join-Path $PSScriptRoot 'imports.sql')) + @($migrations | Where-Object Name -GE '202611030004' | ForEach-Object FullName) + @((Join-Path $PSScriptRoot 'workflows.sql'),(Join-Path $PSScriptRoot 'workflow-integrity.sql'),(Join-Path $PSScriptRoot 'analytics.sql'),(Join-Path $PSScriptRoot 'ai-mapping.sql'),(Join-Path $PSScriptRoot 'assistant.sql'),(Join-Path $PSScriptRoot 'assistant-safety.sql'),(Join-Path $PSScriptRoot 'chat.sql'),(Join-Path $PSScriptRoot 'intelligent-imports.sql'))
  foreach ($file in $files) {
    & (Join-Path $PgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55432 -U phase2_test -d $database -v ON_ERROR_STOP=1 -f $file
    if ($LASTEXITCODE -ne 0) { throw "SQL check failed: $file" }
  }
  & node (Join-Path $PSScriptRoot 'concurrency.mjs') $PgBin $database
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent duplicate protection failed' }
  & node (Join-Path $PSScriptRoot 'call-concurrency.mjs') $PgBin $database
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent confirmation protection failed' }
} finally {
  if ($database -notmatch '^folio_test_[a-f0-9]{32}$') { throw 'Unsafe test database name' }
  & (Join-Path $PgBin 'dropdb.exe') -h 127.0.0.1 -p 55432 -U phase2_test --force --if-exists $database
  if ($started) { & (Join-Path $PgBin 'pg_ctl.exe') -D $cluster -m fast -w stop }
}
