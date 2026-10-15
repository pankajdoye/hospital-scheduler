#Requires -Version 5.1
# Start the Hospital Appointment Scheduler stack (Windows) - single command.
# Ports: Team A=3001, Team B=3000, BFF=4000, Team C=8080.
# Each service opens in its own TITLED window; closing this window won't stop them.
# Re-running is safe: ports already listening are skipped, not duplicated.
# Self-healing:
#   - HOSPITAL_DB_PASSWORD falls back to the saved (setx) value, so ANY terminal works.
#   - Team B's Postgres tables are created + seeded automatically if missing.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

function Test-Port($port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $r = $c.BeginConnect("127.0.0.1", $port, $null, $null)
    $ok = $r.AsyncWaitHandle.WaitOne(500)
    $c.Close()
    return $ok
  } catch { return $false }
}

function Start-NodeService($dirName, $label, $port, $envPort, $title) {
  if (Test-Port $port) {
    Write-Host "[--] $label already listening on :$port, skipping"
    return
  }
  $dir = Join-Path $root $dirName
  $init = "`$host.ui.RawUI.WindowTitle = '$title'; Set-Location '$dir'; "
  if ($envPort -ne "") { $init += "`$env:PORT=$envPort; " }
  $init += "node server.js"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $init | Out-Null
  Write-Host "[OK] $label starting in a new window"
}

Write-Host ""
Write-Host "=== Hospital Appointment Scheduler - start-all ==="
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[!!] Node.js NOT found. Install Node 20 LTS, then re-run."; exit 1
}
Write-Host "[OK] Node.js found"

if (-not (Test-Port 3306)) {
  Write-Host "[!!] WARNING: nothing on :3306 - is the MySQL80 Windows service running? Team C needs it."
}
if (-not (Test-Port 5432)) {
  Write-Host "[!!] WARNING: nothing on :5432 - is Postgres running? Team B needs it."
}

# HOSPITAL_DB_PASSWORD: fall back to the saved (setx) value so stale terminals work too.
if (-not $env:HOSPITAL_DB_PASSWORD) {
  $savedPw = [System.Environment]::GetEnvironmentVariable("HOSPITAL_DB_PASSWORD", "User")
  if ($savedPw) {
    $env:HOSPITAL_DB_PASSWORD = $savedPw
    Write-Host "[OK] HOSPITAL_DB_PASSWORD loaded from saved settings"
  }
}

foreach ($svc in @("team-a", "team-b", "bff")) {
  $dir = Join-Path $root $svc
  if (-not (Test-Path (Join-Path $dir "node_modules"))) {
    Write-Host "Installing dependencies for $svc ..."
    Push-Location $dir; npm install; Pop-Location
  }
}

# Team B database: create + seed tables if missing (idempotent).
$teamBDir = Join-Path $root "team-b"
$ensureJs = 'require("dotenv").config(); const {Client} = require("pg"); const fs = require("fs"); (async () => { const c = new Client({connectionString: process.env.DATABASE_URL}); try { await c.connect(); const r = await c.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname=''public'' AND tablename=''providers''"); if (r.rows[0].n === 0) { console.log("tables missing - running migrate+seed ..."); await c.query(fs.readFileSync("migrations/001_init.sql", "utf8")); await c.query(fs.readFileSync("seed/001_seed.sql", "utf8")); console.log("migrate+seed done"); } else { console.log("tables OK"); } } catch (e) { console.log("DB-ERR: " + e.message); } finally { await c.end().catch(() => {}); } })();'
Set-Content -Path (Join-Path $teamBDir "db-ensure.js") -Value $ensureJs
Write-Host ""
Write-Host "--- Team B database check ---"
Push-Location $teamBDir
node db-ensure.js
Pop-Location

Write-Host ""
Write-Host "--- Starting services ---"
Start-NodeService "team-a" "Team A scheduling engine" 3001 "3001" "Team A :3001"
Start-NodeService "team-b" "Team B availability engine" 3000 "" "Team B :3000"
Start-NodeService "bff" "Team D BFF + frontend" 4000 "" "BFF :4000"

Write-Host ""
Write-Host "--- Team C (Java/MySQL, port 8080) ---"
$teamCDir = Join-Path $root "team-c"
$jar = Join-Path $teamCDir "mysql-connector-j-9.4.0.jar"
if (Test-Port 8080) {
  Write-Host "[--] Team C API already listening on :8080, skipping"
} elseif (-not $env:HOSPITAL_DB_PASSWORD) {
  Write-Host '[!!] HOSPITAL_DB_PASSWORD is not set and no saved value found.'
  Write-Host '     Run once: setx HOSPITAL_DB_PASSWORD "your_mysql_password", then re-run this script.'
} elseif (-not (Test-Path $jar)) {
  Write-Host "[!!] mysql-connector-j-9.4.0.jar not found in team-c\. Download it first."
} else {
  $cmd = "`$host.ui.RawUI.WindowTitle = 'Team C :8080'; Set-Location '$teamCDir'; java -cp '.;*' TeamCApiServer"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd | Out-Null
  Write-Host "[OK] Team C API starting in a new window"
}

Write-Host ""
Write-Host "--- URLs ---"
Write-Host "  Frontend (BFF): http://localhost:4000"
Write-Host "  Team A:         http://localhost:3001/"
Write-Host "  Team B health:  http://localhost:3000/api/health"
Write-Host "  Team C health:  http://localhost:8080/api/v1/health"
Write-Host ""
