# Registers (or re-registers) the Windows scheduled task that runs
# scripts\keepalive.ps1 once a day. Run it once, as the user who stays logged
# in on this PC:
#     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_keepalive_task.ps1
#
# Task settings, and why:
#   • daily at 09:30 local            — one tiny HTTPS request; nothing resident
#   • StartWhenAvailable              — PC was off at 09:30 → runs at next boot/login
#   • RunOnlyIfNetworkAvailable       — no Wi-Fi yet → waits instead of failing
#   • "run only when user is logged on" (the default) → no password stored
#   • 2-minute execution limit, never two at once, no wake-from-sleep
# Remove with:  Unregister-ScheduledTask -TaskName "PokerHelper Supabase keepalive" -Confirm:$false

$ErrorActionPreference = "Stop"
$taskName = "PokerHelper Supabase keepalive"
$script = Join-Path $PSScriptRoot "keepalive.ps1"
if (-not (Test-Path $script)) { throw "not found: $script" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 09:30
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Pings the Poker Helper Supabase project daily so the Free plan does not pause it." `
    -Force | Out-Null

$t = Get-ScheduledTask -TaskName $taskName
Write-Output "registered: $($t.TaskName)  state=$($t.State)"
Write-Output "next run:   $((Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime)"
Write-Output "log:        $env:LOCALAPPDATA\PokerHelper\keepalive.log"
