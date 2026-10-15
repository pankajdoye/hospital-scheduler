#!/usr/bin/env bash
# Start the whole Hospital Appointment Scheduler stack (linux/mac).
# Team C (Java/MySQL) must be started manually — see the printed steps.
# Ports: Team A=3001, Team B=3000, BFF=4000, Team C=8080.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "[OK] $2 found"
  else
    echo "[!!] $2 NOT found. $3"
  fi
}

echo "=== Hospital Appointment Scheduler — start-all ==="
echo ""
check_tool node "Node.js" "Install Node 20 LTS, then re-run."
check_tool java "Java (JDK 21)" "Install a JDK for Team C (manual start)."
check_tool psql "psql (PostgreSQL client)" "Install PostgreSQL 14+ and create the availability DB (see README)."
check_tool mysql "mysql client" "Install MySQL 8 for Team C (manual setup)."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for Teams A, B and the BFF. Aborting."
  exit 1
fi

for svc in team-a team-b bff; do
  if [ ! -d "$ROOT/$svc/node_modules" ]; then
    echo "Installing dependencies for $svc ..."
    (cd "$ROOT/$svc" && npm install)
  fi
done

mkdir -p "$ROOT/logs"
start_node() { # dir label extra-env
  echo "[OK] $2 starting (log: logs/$1.log)"
  (cd "$ROOT/$1" && env $3 nohup node server.js > "$ROOT/logs/$1.log" 2>&1 &)
}

echo ""
echo "--- Starting services ---"
start_node team-a "Team A scheduling engine" "PORT=3001"
start_node team-b "Team B availability engine" ""
start_node bff "Team D BFF + frontend" ""

echo ""
echo "--- Team C (manual — needs MySQL + connector jar) ---"
echo "1. Run in MySQL: team-c/000_base_schema.sql, then team-c/teamc_upgrade.sql"
echo "2. Put mysql-connector-j-9.4.0.jar next to TeamCApiServer.java"
echo "3. In the team-c folder:"
echo "     export HOSPITAL_DB_PASSWORD=your_mysql_password"
echo "     javac -cp '.:*' TeamCApiServer.java"
echo "     java -cp '.:*' TeamCApiServer"
echo ""
echo "--- URLs ---"
echo "  Frontend (BFF):   http://localhost:4000"
echo "  Team A engine:    http://localhost:3001/"
echo "  Team B health:    http://localhost:3000/api/health"
echo "  Team C health:    http://localhost:8080/api/v1/health"
echo ""
