@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   Mystic Mikado - Shadow Dragon Reader
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=.v" %%a in ('node -v') do set NODE_MAJOR=%%a
if "%NODE_MAJOR%"=="" echo Could not determine Node.js version.
echo Building the website...
call npm run build
if errorlevel 1 (
  echo Build failed. Check the error above.
  pause
  exit /b 1
)
echo Starting the website at http://localhost:3000
start "Mystic Mikado" http://localhost:3000
call npm run dev
pause
