@echo off
rem ============================================================
rem  My Browser : build the Windows installer
rem   output: dist\MyBrowser-Setup-x.y.z.exe
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed. Install the "LTS" version first.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

echo Installing parts...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [!] npm install failed. Check your internet connection.
  pause
  exit /b 1
)

echo Building the installer... ^(this takes several minutes^)
call npx electron-builder --win --x64
if errorlevel 1 (
  echo.
  echo [!] Build failed.
  echo     If the message says "Cannot create symbolic link",
  echo     turn on Windows Settings ^> System ^> For developers ^> Developer Mode
  echo     and run this file again.
  pause
  exit /b 1
)

echo.
echo Done! The installer is in the "dist" folder.
start "" explorer "%~dp0dist"
pause
