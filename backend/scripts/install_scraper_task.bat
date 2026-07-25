@echo off
REM Tworzy zaplanowane zadanie Windows: codziennie o 6:00.
REM Dwuklik wystarczy (bez Admina dla bieżącego użytkownika).

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bat = Join-Path '%~dp0' 'run_scraper_daily.bat';" ^
  "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c \"' + $bat + '\"');" ^
  "$trigger = New-ScheduledTaskTrigger -Daily -At 6:00AM;" ^
  "Register-ScheduledTask -TaskName 'GastroManagerDeltaScraper' -Action $action -Trigger $trigger -Description 'Delta-Scraper daily check' -Force | Out-Null;" ^
  "Write-Host 'OK: zadanie GastroManagerDeltaScraper codziennie o 06:00';" ^
  "Get-ScheduledTask -TaskName 'GastroManagerDeltaScraper' | Select-Object TaskName, State"

pause
