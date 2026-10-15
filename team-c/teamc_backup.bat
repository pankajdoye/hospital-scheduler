@echo off
setlocal
if "%HOSPITAL_DB_PASSWORD%"=="" (
  echo Set HOSPITAL_DB_PASSWORD before running this script.
  echo Example: set HOSPITAL_DB_PASSWORD=your_password
  exit /b 1
)
set BACKUP_DIR=%~dp0backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set TODAY=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set NOW=%%a%%b
set FILE=%BACKUP_DIR%\hospital_management_%TODAY%_%NOW%.sql
mysqldump -u root -p%HOSPITAL_DB_PASSWORD% --single-transaction --routines --triggers hospital_management > "%FILE%"
if errorlevel 1 (echo Backup failed.& exit /b 1)
echo Backup created: %FILE%
endlocal
