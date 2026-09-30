<#
  MPBOT autostart: starts the bot ("pm2 resurrect") when Windows boots, even before anyone logs in.

  Run ONCE, in PowerShell opened with "Run as administrator", from the bot folder:
      powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1

  Undo:  powershell -ExecutionPolicy Bypass -File .\scripts\remove-autostart.ps1

  Optional, if node or pm2 can't be found automatically:
      -NodePath "C:\Program Files\nodejs\node.exe"
      -Pm2Path  "C:\Users\<you>\AppData\Roaming\npm\node_modules\pm2\bin\pm2"
#>
param(
  [string]$NodePath,
  [string]$Pm2Path
)

$ErrorActionPreference = 'Stop'
$TaskName = 'MPBOT'

function Ok([string]$text) { Write-Host "[OK] $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "     $text" }
function Fail([string]$text) {
  Write-Host "[X]  $text" -ForegroundColor Red
  Write-Host '     Nothing else was changed.'
  exit 1
}

Write-Host ''
Write-Host 'MPBOT autostart setup' -ForegroundColor Cyan
Write-Host '---------------------'

# 1. Needs Administrator (Windows only allows "at startup" tasks for admins)
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Please open PowerShell with "Run as administrator" and run this script again (see the README).'
}
Ok 'Running as Administrator.'

# 2. The task runs as you, so PM2 uses your own PM2 home (and your saved process list)
$user = "$env:USERDOMAIN\$env:USERNAME"
$pm2Home = if ($env:PM2_HOME) { $env:PM2_HOME } else { Join-Path $env:USERPROFILE '.pm2' }
if (-not (Test-Path (Join-Path $pm2Home 'dump.pm2'))) {
  Fail "PM2 has no saved process list in $pm2Home. Start the bot ('pm2 start ecosystem.config.js'), run 'pm2 save', then run this script again."
}
Ok "Will run as $user with PM2 home $pm2Home"

# 3. Full paths to node.exe and pm2, so the task doesn't depend on PATH
if (-not $NodePath) {
  $found = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($found) { $NodePath = $found.Source }
}
if (-not $NodePath -or -not (Test-Path $NodePath)) {
  Fail "Could not find node.exe. Run the script again with -NodePath 'C:\Program Files\nodejs\node.exe' (your real path)."
}
if (-not $Pm2Path) {
  $candidates = @()
  try { $candidates += Join-Path ((& npm.cmd root -g) | Select-Object -Last 1) 'pm2\bin\pm2' } catch { }
  $candidates += Join-Path $env:APPDATA 'npm\node_modules\pm2\bin\pm2'
  $pm2Cmd = Get-Command pm2.cmd -ErrorAction SilentlyContinue
  if ($pm2Cmd) { $candidates += Join-Path (Split-Path $pm2Cmd.Source) 'node_modules\pm2\bin\pm2' }
  $Pm2Path = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $Pm2Path -or -not (Test-Path $Pm2Path)) {
  Fail "Could not find pm2. Is it installed (npm install -g pm2)? Or run again with -Pm2Path '<path to node_modules\pm2\bin\pm2>'."
}
Ok "node: $NodePath"
Ok "pm2:  $Pm2Path"

# 4. A tiny launcher in the PM2 home: sets PM2_HOME, runs "pm2 resurrect", writes to a log file
$launcher = Join-Path $pm2Home 'mpbot-autostart.cmd'
$log = Join-Path $pm2Home 'mpbot-autostart.log'
Set-Content -Path $launcher -Encoding Ascii -Value @(
  '@echo off',
  'rem Created by MPBOT scripts\setup-autostart.ps1. Started by the "MPBOT" scheduled task when Windows boots.',
  "set `"PM2_HOME=$pm2Home`"",
  "echo [%date% %time%] Windows started: running pm2 resurrect>> `"$log`"",
  "`"$NodePath`" `"$Pm2Path`" resurrect >> `"$log`" 2>&1",
  'exit /b %errorlevel%'
)
Ok "Launcher written: $launcher"

# 5. Your Windows password, through the normal Windows prompt. Task Scheduler stores it securely;
#    it is never written to a file.
Write-Host ''
Info 'A Windows window will now ask for your password. It lets the task run before you log in.'
Info 'Use the password you sign in to Windows with (your Microsoft account password if you use one), not your PIN.'
$cred = Get-Credential -UserName $user -Message "Windows password for $user (needed so MP Bot can start before you log in)"
if (-not $cred) { Fail 'No password entered.' }

# 6. The scheduled task
$existed = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/d /c `"$launcher`"" -WorkingDirectory $pm2Home
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S' # 30 seconds after boot, so the network (and WARP) are up
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
try {
  Register-ScheduledTask -TaskName $TaskName -Force `
    -Description 'Starts MP Bot (pm2 resurrect) when Windows boots, even before anyone logs in. Created by MPBOT scripts\setup-autostart.ps1.' `
    -Action $action -Trigger $trigger -Settings $settings `
    -User $user -Password $cred.GetNetworkCredential().Password -RunLevel Limited | Out-Null
} catch {
  Fail "Windows did not accept the task: $($_.Exception.Message) (Wrong password? Use your Windows sign-in password, not your PIN.)"
} finally {
  $cred = $null
}
if ($existed) { Ok "Scheduled task '$TaskName' updated." } else { Ok "Scheduled task '$TaskName' created." }
Info 'Runs at every Windows startup (30 s delay), also when nobody is logged in, without any window.'
Info 'If it fails it retries up to 5 times (1 minute apart); there is no time limit; it also runs on battery.'

# 7. Remove the old Startup-folder .bat, so the bot isn't started twice
$removed = $false
foreach ($folder in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  $bat = Join-Path $folder 'start-mpbot.bat'
  if (Test-Path $bat) {
    Remove-Item -LiteralPath $bat -Force
    Ok "Removed the old $bat (the task replaces it)."
    $removed = $true
  }
}
if (-not $removed) { Ok 'No old start-mpbot.bat in the Startup folder.' }

Write-Host ''
Write-Host 'Done!' -ForegroundColor Cyan
Info 'Test it: restart the laptop and wait about a minute without logging in; MP Bot should come online in Discord.'
Info "Then log in and run 'pm2 list'. Each start is logged in: $log"
Info 'If you change your Windows password, run this script again.'
Write-Host ''
