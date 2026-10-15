# Hospital Online Appointment System — Full Stack

4-team class project. Team D owns this repo: total integration + frontend.

## Architecture

| Service | Owner | Stack | Port | Data |
|---|---|---|---|---|
| Team A — scheduling engine | Team A | Node/Express, in-memory | **3001** | booking queue, slot locks, policies (FCFS / PRIORITY / EARLIEST-FIT / URGENCY-WEIGHTED), deadlock analysis |
| Team B — availability & conflict engine | Team B | Node/Express + PostgreSQL | **3000** | providers, working hours, calendar entries (booked/blocked), settings |
| Team C — appointment data & transaction manager | Team C | Java 21 + MySQL 8 | **8080** | authoritative appointments, patients, idempotency keys, audit log, outbox |
| BFF + frontend | Team D (this build) | Node/Express, vanilla JS | **4000** | normalizes A/B/C into one API; serves the SPA |

Team A and Team B both defaulted to port 3000, so Team A runs on **3001**
(`PORT` env var; `team-a/server.js` is otherwise byte-identical to Team A's file).

## Prerequisites

- Node.js 20+ (Teams A, B, BFF)
- PostgreSQL 14+ (Team B) — service running
- MySQL 8 (Team C) — service running
- JDK 21 (Team C)
- `mysql-connector-j-9.4.0.jar` placed in `team-c/` next to `TeamCApiServer.java`

No TypeScript, no build steps, no CDN dependencies anywhere — everything is
`npm install && node server.js`.

## Setup order

1. **PostgreSQL (Team B)** — create user/db, then migrate + seed:
   ```sql
   CREATE USER availability WITH PASSWORD 'availability';
   CREATE DATABASE availability OWNER availability;
   ```
   ```bash
   cd team-b
   npm install
   # copy .env.example to .env if you need to change anything
   npm run db:migrate
   npm run db:seed
   ```
2. **MySQL (Team C)** — in MySQL Workbench, run in order:
   1. `team-c/000_base_schema.sql` (base tables TeamCApiServer expects + 3 seed doctors)
   2. `team-c/teamc_upgrade.sql` (idempotency, audit, outbox, recovery, calendar intervals)
3. **Start everything** — `scripts/start-all.ps1` (Windows) or `scripts/start-all.sh` (linux/mac).
   It checks tools, installs deps, starts A/B/BFF, and prints the manual Team C steps:
   ```bat
   set HOSPITAL_DB_PASSWORD=your_mysql_password
   javac -cp ".;*" TeamCApiServer.java
   java -cp ".;*" TeamCApiServer
   ```
4. Open **http://localhost:4000**. The banner shows each service up/down live.

## Demo walkthrough

1. **Search & Book** tab: pick a provider, date range, duration → Search → pick a slot → choose a patient → Confirm. You get an appointment id.
2. **Appointments** tab: the booking appears (Team C is the source of truth). Cancel it — the audit trail records the CANCEL.
3. **Patients** tab: register a patient (phone = 10 digits, email must be `@gmail.com` — Team C validates).
4. **Scheduling** tab: Dr. Asha Patil → EARLIEST-FIT → Run scheduler → queue + metrics (Team A). Note: scheduling only works for Asha (Team A has slots for PROV001 only).
5. **Analytics** tab: booked/blocked/utilization + date-wise report (Team B).
6. **Settings** tab: read/update Team B settings (replaces the old localStorage settings).
7. **Audit** tab: every Team C write with actor, action, correlation id (admin token required).

## Provider-ID mapping (Team D integration contract)

| BFF / Team B (UUID) | Team C (doctor_id) | Team A (slot id) | Name |
|---|---|---|---|
| `11111111-1111-1111-1111-111111111111` | 1 | `PROV001` | Dr. Asha Patil |
| `22222222-2222-2222-2222-222222222222` | 2 | — | Dr. Rahul Sharma |
| `33333333-3333-3333-3333-333333333333` | 3 | — | Dr. Priya Deshmukh |

The BFF (`bff/config.js` → `PROVIDER_MAP`) translates between these. The frontend
only ever uses the UUID. Names are identical in the Team B seed and the Team C
base schema so a name-based fallback is possible if ids drift.

The BFF injects what each team requires: `Authorization: Bearer <token>` and
`X-Correlation-ID` for Team C, a fresh `Idempotency-Key` per booking POST.
Every BFF response is normalized to `{"success": true, "data": ...}` /
`{"success": false, "error": ...}`; a dead downstream service returns HTTP 502
`{"success": false, "error": "team-x unavailable"}` instead of hanging.

## Known limitations

- **Team A slots only for PROV001** (Dr. Asha Patil). Scheduling endpoints for the
  other two providers return HTTP 501 from the BFF.
- **Booking authority overlap**: Team B can write `calendar_entries`
  (`POST /api/providers/:id/entries`) while Team C is documented as the only
  writer of authoritative appointments. The frontend books through Team C;
  Team B entries are treated as availability blocks, not appointments.
- **Team C demo tokens** (`teamc-admin-demo` etc.) are classroom placeholders —
  replace with JWT/OAuth2 before any real deployment.
- Team B date math is done in **Asia/Kolkata** (seed data is IST).
- Team A is in-memory: queues, locks and decisions reset on restart.
