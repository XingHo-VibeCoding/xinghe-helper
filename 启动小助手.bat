@echo off
title xinghe-helper - RUNNING

cd /d "%~dp0web"
if not exist "package.json" (
  echo [ERROR] Cannot find web/package.json
  echo         Put this file in the project root folder.
  pause
  exit /b 1
)

echo ============================================
echo    xinghe-helper  -  Starting up
echo ============================================
echo.

set NODE_EXE=
for %%I in (node.exe) do set NODE_EXE=%%~$PATH:I

if not defined NODE_EXE (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" set NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe
)
if not defined NODE_EXE (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\current\node.exe" set NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\current\node.exe
)

if not defined NODE_EXE (
  echo [ERROR] Node.js not found.
  echo.
  echo   Fix: install Node.js LTS from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo   Node: %NODE_EXE%
echo.

for %%I in ("%NODE_EXE%") do set NODE_DIR=%%~dpI
set PATH=%NODE_DIR%;%PATH%

if not exist "node_modules" (
  echo   First run: installing dependencies, please wait ...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check network and retry.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  echo   [WARN] .env not found - database connection will fail.
  echo.
)

echo ============================================
echo   Server starting ...
echo   Browser will open at:  http://localhost:5173
echo.
echo   *** KEEP THIS WINDOW OPEN ***
echo   Closing it stops the server.
echo ============================================
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"

call npm run dev

echo.
echo   Server stopped.
pause
