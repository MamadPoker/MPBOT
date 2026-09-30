<#
  Undoes scripts\setup-autostart.ps1: MP Bot no longer starts by itself when Windows boots.
  The bot keeps running right now; this only removes the automatic start.

  Run in PowerShell opened with "Run as administrator", from the bot folder:
      powershell -ExecutionPolicy Bypass -File .\scripts\remove-autostart.ps1
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'MPBOT'

function Ok([string]$text) { Write-Host "[OK] $text" -ForegroundColor Green }

Write-Host ''
Write-Host 'MPBOT autostart removal' -ForegroundColor Cyan
Write-Host '-----------------------'

$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[X]  Please open PowerShell with "Run as administrator" and run this script again.' -ForegroundColor Red
  exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Ok "Removed the scheduled task '$TaskName'."
} else {
  Ok "There was no scheduled task '$TaskName'."
}

$pm2Home = if ($env:PM2_HOME) { $env:PM2_HOME } else { Join-Path $env:USERPROFILE '.pm2' }
$launcher = Join-Path $pm2Home 'mpbot-autostart.cmd'
if (Test-Path $launcher) {
  Remove-Item -LiteralPath $launcher -Force
  Ok "Removed $launcher"
}

Write-Host ''
Write-Host 'MP Bot will no longer start by itself when Windows starts.'
Write-Host "It is still running now (see 'pm2 list'). To start it by hand after a reboot: pm2 resurrect"
Write-Host ''
