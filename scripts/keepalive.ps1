# Supabase keep-alive. One POST to the keepalive() RPC, then exit.
#
# Supabase pauses Free projects that show "low activity over a 7-day period";
# its own guidance is that a few database requests per day is enough. Windows
# Task Scheduler runs this once a day (see README "保活"); nothing stays
# resident between runs. The RPC only writes to keepalive_log (pruned at 90
# days) — it never touches sessions / venues / stakes.
#
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\keepalive.ps1
# Exit code 0 = the database answered, 1 = it did not (see the log).
# Log: %LOCALAPPDATA%\PokerHelper\keepalive.log  (the task runs hidden, so
# the log is the only place a failure shows up).

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:LOCALAPPDATA "PokerHelper"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "keepalive.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    # Same URL / key as js/config.js (the publishable key is public by design).
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $config = Get-Content (Join-Path $repoRoot "js\config.js") -Raw
    $url = [regex]::Match($config, 'SUPABASE_URL\s*=\s*"([^"]+)"').Groups[1].Value
    $key = [regex]::Match($config, 'SUPABASE_KEY\s*=\s*"([^"]+)"').Groups[1].Value
    if (-not $url -or -not $key) { throw "js/config.js: SUPABASE_URL / SUPABASE_KEY not found" }

    $resp = Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/keepalive" `
        -Headers @{ apikey = $key; Authorization = "Bearer $key" } `
        -ContentType "application/json" -Body '{"src":"pc-task"}' -TimeoutSec 30
    Add-Content -Path $log -Value "$stamp OK  server time $resp"
    exit 0
} catch {
    Add-Content -Path $log -Value "$stamp FAIL $($_.Exception.Message)"
    exit 1
}
