@echo off
rem waxyct: double-click to start the CT router and open its window. This console IS the router:
rem minimise it, don't close it while an owner holds the CT (closing it still closes the CT cleanly).
title waxyct - CT router
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js is not installed or not on PATH. Install it from https://nodejs.org, then try again.
  pause
  exit /b 1
)
rem Dependencies live in this checkout. Never restore an old studio archive.
if not exist "integrations\ct-td-control\node_modules\serialport\package.json" goto missing_bridge
if not exist "integrations\ct-td-control\node_modules\loupedeck\package.json" goto missing_bridge
goto ready

:missing_bridge
echo Bridge dependencies are missing. From this folder run: npm run setup:bridge
pause
exit /b 1

:ready
rem Already running: router.mjs brings the open waxyct window forward (or opens one) and exits.
node router.mjs --open
if errorlevel 1 (
  echo.
  echo waxyct stopped with an error, above.
  pause
)
