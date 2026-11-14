@echo off
rem Starts the development server. Uses the portable Node.js in %USERPROFILE%\tools
rem when Node.js is not on PATH (it was unpacked there during the initial build).
setlocal
where node >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%USERPROFILE%\tools\node-v*-win-x64") do set "PATH=%%D;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it with:  winget install OpenJS.NodeJS.LTS
  exit /b 1
)
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run dev -- --open
