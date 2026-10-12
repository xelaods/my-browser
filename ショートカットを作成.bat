@echo off
rem ============================================================
rem  My Browser : create shortcuts on the Desktop and Start menu
rem  Double-click this file once. After that, start My Browser
rem  from the Desktop icon or the Start menu (no cmd needed).
rem ============================================================
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] Electron is not installed yet.
  echo     Open cmd in this folder and run:  npm install
  pause
  exit /b 1
)

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
echo Done! Double-click "My Browser" on your Desktop to start.
echo (Tip: right-click the Start menu entry and choose "Pin to taskbar".)
pause
