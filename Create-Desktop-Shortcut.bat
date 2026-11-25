@echo off
cd /d "%~dp0"
echo Creating Desktop Shortcut for Dropbox Order Opener...

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$sc = $ws.CreateShortcut(\"$desktop\Dropbox Order Opener.lnk\"); " ^
  "$sc.TargetPath = 'cmd.exe'; " ^
  "$sc.Arguments = '/c start \"\" pythonw.exe \"' + $PSScriptRoot + '\order_opener_app.py\"'; " ^
  "$sc.WorkingDirectory = $PSScriptRoot; " ^
  "$sc.IconLocation = 'shell32.dll,275'; " ^
  "$sc.Description = 'Dropbox Order Opener - Photoshop Audit Tool'; " ^
  "$sc.Save(); " ^
  "Write-Host 'Desktop shortcut created successfully!' -ForegroundColor Green;"

pause
