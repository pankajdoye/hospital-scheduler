@echo off
setlocal
if "%HOSPITAL_DB_PASSWORD%"=="" (
  echo Set HOSPITAL_DB_PASSWORD before running this script.
  exit /b 1
)
if "%~1"=="" (
  echo Usage: teamc_restore.bat backups\hospital_management_file.sql
  exit /b 1
)
set FILE=%~1
if not exist "%FILE%" (echo Backup file not found: %FILE%& exit /b 1)
mysql -u root -p%HOSPITAL_DB_PASSWORD% hospital_management < "%FILE%"
if errorlevel 1 (echo Restore failed.& exit /b 1)
echo Restore completed from: %FILE%
endlocal
