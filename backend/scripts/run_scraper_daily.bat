@echo off
REM Harmonogram Windows — raz na dobę sprawdza scrape_targets (Delta-Scraper).
REM Instalacja zadania (jako Administrator): scripts\install_scraper_task.bat

setlocal
cd /d "%~dp0.."
set PYTHONUNBUFFERED=1

echo [%DATE% %TIME%] Delta-Scraper check start >> "%~dp0scraper_cron.log"
python scripts\scraper_cli.py check >> "%~dp0scraper_cron.log" 2>&1
set EXITCODE=%ERRORLEVEL%
echo [%DATE% %TIME%] exit=%EXITCODE% >> "%~dp0scraper_cron.log"
exit /b %EXITCODE%
