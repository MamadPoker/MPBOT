@echo off
rem MP Bot updater: double-click this file to update and restart the bot.
rem PM2 runs with administrator rights (started by the MPBOT scheduled task), so this asks for them first.
setlocal

rem --- Administrator rights? If not, ask Windows (UAC prompt) and start this file again as administrator.
fltmc >nul 2>&1
if errorlevel 1 (
  echo Asking Windows for administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Administrator rights are needed to restart the bot. Nothing was changed.
    pause
  )
  exit /b
)

title MP Bot update
cd /d "%~dp0.."
echo MP Bot update
echo Bot folder: %CD%
echo.

set "STEP=1/4 git pull"
echo [1/4] Downloading the latest version (git pull)...
for /f %%i in ('git rev-parse HEAD') do set "BEFORE=%%i"
git pull
if errorlevel 1 goto failed
for /f %%i in ('git rev-parse HEAD') do set "AFTER=%%i"
echo.

set "STEP=2/4 npm install"
echo [2/4] Checking if the packages changed...
set "PACKAGES="
for /f %%f in ('git diff --name-only %BEFORE% %AFTER% -- package.json package-lock.json') do set "PACKAGES=1"
if not defined PACKAGES (
  echo No package changes, skipping npm install.
  goto restart
)
echo package.json or package-lock.json changed: running npm install...
call npm install
if errorlevel 1 goto failed

:restart
echo.
set "STEP=3/4 restart"
set "SETTINGS="
for /f %%f in ('git diff --name-only %BEFORE% %AFTER% -- ecosystem.config.js') do set "SETTINGS=1"
if defined SETTINGS goto reload
echo [3/4] Restarting the bot (pm2 restart mpbot)...
call pm2 restart mpbot
if errorlevel 1 goto failed
goto status

:reload
rem PM2's settings file changed: a restart doesn't apply it, so start the bot again from it and save
echo [3/4] ecosystem.config.js changed: reloading the bot with the new PM2 settings...
call pm2 delete mpbot
call pm2 start ecosystem.config.js
if errorlevel 1 goto failed
call pm2 save
if errorlevel 1 goto failed

:status
echo.
echo [4/4] Current status:
call pm2 list
echo.
echo Done! Check above that mpbot is "online".
echo.
pause
exit /b 0

:failed
echo.
echo Something went wrong in step %STEP% (see the error above).
echo If git complains about "dubious ownership", run the command it suggests, then try again.
echo.
pause
exit /b 1
