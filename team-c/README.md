# Team C — Appointment Data & Transaction Manager

Authoritative MySQL component for the Appointment Scheduler Engine.
Written by Team C (Java 21); collected here so Team D can deploy it.

## Files

| File | Purpose |
|---|---|
| `000_base_schema.sql` | NEW: base MySQL schema TeamCApiServer expects (doctors, patients, appointments + seed). Run first. |
| `teamc_upgrade.sql` | Team C additive migration: idempotency keys, audit log, outbox, recovery checks, provider-calendar intervals, indexes. Run second. |
| `TeamCApiServer.java` | Versioned Team C REST API (`/api/v1`), port 8080. |
| `teamc_backup.bat` / `teamc_restore.bat` | Windows backup/restore scripts. |

## Setup (Windows)

1. Start MySQL. Create the root login Team C uses (`root` / your password).
2. In MySQL Workbench, run `000_base_schema.sql`, then `teamc_upgrade.sql`.
3. Put `mysql-connector-j-9.4.0.jar` in this folder (next to the .java file).
4. In Command Prompt, in this folder:

```bat
set HOSPITAL_DB_PASSWORD=your_mysql_password
javac -cp ".;*" TeamCApiServer.java
java -cp ".;*" TeamCApiServer
```

Expected output:

```text
Connected to MySQL: hospital_management
Team C API running at http://localhost:8080/api/v1
```

## Auth

Demo tokens (classroom only — replace with JWT/OAuth2 before any real deployment):

- `teamc-admin-demo` → ADMIN
- `teamc-provider-demo` → PROVIDER
- `teamc-patient-demo` → PATIENT

Every protected request needs `Authorization: Bearer <token>` and `X-Correlation-ID`.
Booking (`POST /api/v1/appointments`) additionally requires `Idempotency-Key`.

## Notes for Team D (integration)

- Response envelope is `{"data": ..., "meta": {"correlation_id": ..., "api_version": "v1"}}`;
  errors are `{"error": {"code": ..., "message": ...}, "meta": {...}}`.
- `book()` inserts without `status`, so the base schema defaults it to
  `CONFIRMED`; `cancel()` only accepts `BOOKED`/`CONFIRMED`.
- The unique key `uq_doctor_slot (doctor_id, appointment_date, appointment_time)`
  is what turns a double booking into MySQL error 1062 → `SLOT_CONFLICT`.
- Patient validation is strict: phone = exactly 10 digits, email must be
  `@gmail.com` (enforced by the Java server, not by SQL).
- `/api/v1/audit` and `/internal/v1/recovery/verify` need the ADMIN token;
  `/api/v1/reports/utilization` needs ADMIN or PROVIDER.
