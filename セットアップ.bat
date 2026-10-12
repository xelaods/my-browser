@echo off
rem ============================================================
rem  My Browser : one-click setup
rem   1. checks Node.js
rem   2. installs Electron (first time only)
rem   3. creates "My Browser" shortcuts on the Desktop and Start menu
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed.
  echo     The download page will open. Install the "LTS" version,
  echo     then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

rem Install / update all parts (quick when nothing changed)
echo Installing parts... ^(this takes a few minutes the first time^)
call npm install --no-audit --no-fund
rem Newer npm may skip Electron's download step. Run it directly
rem (it does nothing when the right Electron version is already there).
call node node_modules\electron\install.js
if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] Electron could not be installed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo Creating shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$app = (Get-Location).Path;" ^
  "$exe = Join-Path $app 'node_modules\electron\dist\electron.exe';" ^
  "$ico = Join-Path $app 'build\icon.ico';" ^
  "$q = [char]34;" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$dirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'));" ^
  "foreach ($d in $dirs) {" ^
  "  $s = $ws.CreateShortcut((Join-Path $d 'My Browser.lnk'));" ^
  "  $s.TargetPath = $exe;" ^
  "  $s.Arguments = $q + $app + $q;" ^
  "  $s.WorkingDirectory = $app;" ^
  "  $s.IconLocation = $ico + ',0';" ^
  "  $s.Description = 'My Browser';" ^
  "  $s.Save();" ^
  "  Write-Host ('Created: ' + (Join-Path $d 'My Browser.lnk'))" ^
  "}"
if errorlevel 1 (
  echo [!] Failed to create shortcuts.
  pause
  exit /b 1
)

echo.
echo Done! Starting My Browser...
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
timeout /t 3 >nul
