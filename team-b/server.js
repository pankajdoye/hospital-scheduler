/**
 * Team B — Appointment Scheduler / Availability & Conflict Engine
 * Plain-JS Express + PostgreSQL backend. Base path: /api
 *
 * Run: npm install && npm run db:migrate && npm run db:seed && node server.js
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;
const IST_OFFSET = "+05:30"; // seed/demo data is in Asia/Kolkata

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
});

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// ---------- helpers ----------

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isDateStr(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(dateStr) {
  return new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat, matches schema
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function toMin(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function minToHm(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return h + ":" + m;
}

// IST day window for deterministic date filtering regardless of DB session TZ
function dayWindow(dateStr) {
  return [
    `${dateStr}T00:00:00${IST_OFFSET}`,
    `${addDays(dateStr, 1)}T00:00:00${IST_OFFSET}`,
  ];
}

const ENTRY_SQL = `
  SELECT id, provider_id,
         to_char(start_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS start_hm,
         to_char(end_time   AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS end_hm,
         start_time, end_time, status, title, reason
  FROM calendar_entries`;

async function getProviderOr404(res, providerId) {
  if (!isUuid(providerId)) {
    fail(res, 400, "Invalid providerId (must be a UUID)");
    return null;
  }
  const r = await pool.query(
    "SELECT id, name, specialty FROM providers WHERE id = $1 AND active = TRUE",
    [providerId]
  );
  if (r.rows.length === 0) {
    fail(res, 404, "Provider not found");
    return null;
  }
  return r.rows[0];
}

async function getDayEntries(providerId, dateStr) {
  const [start, end] = dayWindow(dateStr);
  const r = await pool.query(
    `${ENTRY_SQL}
     WHERE provider_id = $1 AND start_time >= $2::timestamptz AND start_time < $3::timestamptz
     ORDER BY start_time`,
    [providerId, start, end]
  );
  return r.rows;
}

function subtractBusy(workStart, workEnd, busy) {
  // busy: [{startMin,endMin}] sorted; returns free [{startMin,endMin}]
  const free = [];
  let cursor = workStart;
  for (const b of busy) {
    if (b.endMin <= cursor) continue;
    if (b.startMin > cursor) free.push({ startMin: cursor, endMin: Math.min(b.startMin, workEnd) });
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= workEnd) break;
  }
  if (cursor < workEnd) free.push({ startMin: cursor, endMin: workEnd });
  return free;
}

function splitSlots(freeIntervals, durationMin) {
  const slots = [];
  for (const f of freeIntervals) {
    let s = f.startMin;
    while (s + durationMin <= f.endMin) {
      slots.push({ start: minToHm(s), end: minToHm(s + durationMin) });
      s += durationMin;
    }
  }
  return slots;
}

function preferenceOk(startHm, timePreference) {
  const mins = toMin(startHm);
  switch (timePreference) {
    case "Morning": return mins < 12 * 60;
    case "Afternoon": return mins >= 12 * 60 && mins < 17 * 60;
    case "Evening": return mins >= 17 * 60;
    case "Any Time":
    default: return true;
  }
}

async function handleError(res, err, what) {
  console.error(`[team-b] ${what}:`, err.message);
  return fail(res, 500, "Internal server error");
}

// ---------- routes ----------

// GET /api/health
app.get("/api/health", async (req, res) => {
  let database = "connected";
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    database = "disconnected";
  }
  return ok(res, { service: "team-b-appointment-backend", database });
});

// GET /api/providers
app.get("/api/providers", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, name, specialty FROM providers WHERE active = TRUE ORDER BY name"
    );
    return ok(res, r.rows);
  } catch (e) {
    return handleError(res, e, "GET /api/providers");
  }
});

// POST /api/availability/search
app.post("/api/availability/search", async (req, res) => {
  try {
    const { providerId, dateFrom, dateTo, durationMinutes, timePreference } = req.body || {};

    const provider = await getProviderOr404(res, providerId);
    if (!provider) return;

    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      return fail(res, 400, "durationMinutes must be a positive integer");
    }
    if (!isDateStr(dateFrom) || !isDateStr(dateTo)) {
      return fail(res, 400, "dateFrom and dateTo must be YYYY-MM-DD");
    }
    if (dateFrom > dateTo) {
      return fail(res, 400, "dateFrom must be on or before dateTo");
    }
    const pref = timePreference || "Any Time";
    if (!["Any Time", "Morning", "Afternoon", "Evening"].includes(pref)) {
      return fail(res, 400, "timePreference must be one of: Any Time, Morning, Afternoon, Evening");
    }

    const slots = [];
    for (let d = dateFrom; d <= dateTo; d = addDays(d, 1)) {
      const dow = weekday(d);
      const wh = await pool.query(
        `SELECT to_char(start_time,'HH24:MI') AS start_hm, to_char(end_time,'HH24:MI') AS end_hm
         FROM working_hours WHERE provider_id = $1 AND day_of_week = $2 ORDER BY start_time`,
        [providerId, dow]
      );
      if (wh.rows.length === 0) continue;

      const entries = await getDayEntries(providerId, d);
      const busy = entries
        .map((e) => ({ startMin: toMin(e.start_hm), endMin: toMin(e.end_hm) }))
        .sort((a, b) => a.startMin - b.startMin);

      for (const w of wh.rows) {
        const free = subtractBusy(toMin(w.start_hm), toMin(w.end_hm), busy);
        for (const s of splitSlots(free, duration)) {
          if (preferenceOk(s.start, pref)) slots.push({ date: d, start: s.start, end: s.end });
        }
      }
    }

    return ok(res, { providerId, slots });
  } catch (e) {
    return handleError(res, e, "POST /api/availability/search");
  }
});

// GET /api/providers/:providerId/slot-lookup?date=&startTime=&durationMinutes=
app.get("/api/providers/:providerId/slot-lookup", async (req, res) => {
  try {
    const { providerId } = req.params;
    const { date, startTime, durationMinutes } = req.query;

    const provider = await getProviderOr404(res, providerId);
    if (!provider) return;

    if (!isDateStr(date)) return fail(res, 400, "date must be YYYY-MM-DD");
    if (typeof startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      return fail(res, 400, "startTime must be HH:MM (00:00-23:59)");
    }
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      return fail(res, 400, "durationMinutes must be a positive integer");
    }

    const startIso = `${date}T${startTime}:00${IST_OFFSET}`;
    const startMin = toMin(startTime);
    const endMin = startMin + duration;
    const endDate = endMin >= 24 * 60 ? addDays(date, 1) : date;
    const endIsoLocal = `${endDate}T${minToHm(endMin % (24 * 60))}:00${IST_OFFSET}`;

    const r = await pool.query(
      `${ENTRY_SQL}
       WHERE provider_id = $1 AND start_time < $3::timestamptz AND end_time > $2::timestamptz
       ORDER BY start_time`,
      [providerId, startIso, endIsoLocal]
    );

    return ok(res, {
      available: r.rows.length === 0,
      conflicts: r.rows.map((e) => ({
        id: e.id, start: e.start_hm, end: e.end_hm,
        status: e.status, title: e.title, reason: e.reason,
      })),
    });
  } catch (e) {
    return handleError(res, e, "GET slot-lookup");
  }
});

// GET /api/providers/:providerId/calendar?date=
app.get("/api/providers/:providerId/calendar", async (req, res) => {
  try {
    const { providerId } = req.params;
    const { date } = req.query;

    const provider = await getProviderOr404(res, providerId);
    if (!provider) return;
    if (!isDateStr(date)) return fail(res, 400, "date must be YYYY-MM-DD");

    const dow = weekday(date);
    const wh = await pool.query(
      `SELECT day_of_week, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
       FROM working_hours WHERE provider_id = $1 AND day_of_week = $2 ORDER BY start_time`,
      [providerId, dow]
    );
    const entries = await getDayEntries(providerId, date);

    return ok(res, {
      date,
      workingHours: wh.rows,
      entries: entries.map((e) => ({
        id: e.id, start_time: e.start_hm, end_time: e.end_hm,
        status: e.status, title: e.title, reason: e.reason,
      })),
    });
  } catch (e) {
    return handleError(res, e, "GET calendar");
  }
});

// GET /api/providers/:providerId/analytics?from=&to=
app.get("/api/providers/:providerId/analytics", async (req, res) => {
  try {
    const { providerId } = req.params;
    const provider = await getProviderOr404(res, providerId);
    if (!provider) return;

    const from = req.query.from && isDateStr(req.query.from) ? req.query.from : addDays(todayStr(), -30);
    const to = req.query.to && isDateStr(req.query.to) ? req.query.to : todayStr();
    const [wFrom] = dayWindow(from);
    const [, wTo] = dayWindow(to);

    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='booked') AS booked,
              COUNT(*) FILTER (WHERE status='blocked') AS blocked
       FROM calendar_entries
       WHERE provider_id = $1 AND start_time >= $2::timestamptz AND start_time < $3::timestamptz`,
      [providerId, wFrom, wTo]
    );
    const booked = Number(counts.rows[0].booked);
    const blocked = Number(counts.rows[0].blocked);

    const busy = await pool.query(
      `SELECT to_char(start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, COUNT(*) AS n
       FROM calendar_entries
       WHERE provider_id = $1 AND status = 'booked'
         AND start_time >= $2::timestamptz AND start_time < $3::timestamptz
       GROUP BY 1 ORDER BY n DESC LIMIT 1`,
      [providerId, wFrom, wTo]
    );

    const total = booked + blocked;
    return ok(res, {
      totalBooked: booked,
      totalBlocked: blocked,
      utilizationPct: total === 0 ? 0 : Math.round((booked / total) * 1000) / 10,
      busiestDate: busy.rows.length ? busy.rows[0].day : null,
    });
  } catch (e) {
    return handleError(res, e, "GET analytics");
  }
});

// GET /api/reports?from=&to=
app.get("/api/reports", async (req, res) => {
  try {
    const from = req.query.from && isDateStr(req.query.from) ? req.query.from : addDays(todayStr(), -30);
    const to = req.query.to && isDateStr(req.query.to) ? req.query.to : todayStr();
    if (from > to) return fail(res, 400, "from must be on or before to");
    const [wFrom] = dayWindow(from);
    const [, wTo] = dayWindow(to);

    const r = await pool.query(
      `SELECT d::date AS day,
              COUNT(e.id) FILTER (WHERE e.status='booked') AS booked,
              COUNT(e.id) FILTER (WHERE e.status='blocked') AS blocked
       FROM generate_series($1::date, $2::date, interval '1 day') AS d
       LEFT JOIN calendar_entries e
         ON e.start_time >= (d::date::text || 'T00:00:00+05:30')::timestamptz
        AND e.start_time < ((d::date + 1)::text || 'T00:00:00+05:30')::timestamptz
       GROUP BY d ORDER BY d`,
      [from, to]
    );
    return ok(res, r.rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      booked: Number(row.booked),
      blocked: Number(row.blocked),
    })));
  } catch (e) {
    return handleError(res, e, "GET /api/reports");
  }
});

// GET /api/settings
app.get("/api/settings", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM settings WHERE id = 1");
    if (r.rows.length === 0) return fail(res, 404, "Settings not found");
    return ok(res, r.rows[0]);
  } catch (e) {
    return handleError(res, e, "GET /api/settings");
  }
});

// PUT /api/settings
app.put("/api/settings", async (req, res) => {
  try {
    const {
      default_duration_minutes, time_format,
      auto_refresh, show_conflict_alerts, daily_summary,
    } = req.body || {};

    if (default_duration_minutes !== undefined &&
        (!Number.isInteger(default_duration_minutes) || default_duration_minutes <= 0)) {
      return fail(res, 400, "default_duration_minutes must be a positive integer");
    }
    if (time_format !== undefined && !["12", "24"].includes(String(time_format))) {
      return fail(res, 400, "time_format must be '12' or '24'");
    }
    for (const [k, v] of [["auto_refresh", auto_refresh], ["show_conflict_alerts", show_conflict_alerts], ["daily_summary", daily_summary]]) {
      if (v !== undefined && typeof v !== "boolean") {
        return fail(res, 400, `${k} must be a boolean`);
      }
    }

    const r = await pool.query(
      `UPDATE settings SET
         default_duration_minutes = COALESCE($1, default_duration_minutes),
         time_format = COALESCE($2, time_format),
         auto_refresh = COALESCE($3, auto_refresh),
         show_conflict_alerts = COALESCE($4, show_conflict_alerts),
         daily_summary = COALESCE($5, daily_summary),
         updated_at = NOW()
       WHERE id = 1 RETURNING *`,
      [default_duration_minutes ?? null, time_format ?? null,
       auto_refresh ?? null, show_conflict_alerts ?? null, daily_summary ?? null]
    );
    if (r.rows.length === 0) return fail(res, 404, "Settings not found");
    return ok(res, r.rows[0]);
  } catch (e) {
    return handleError(res, e, "PUT /api/settings");
  }
});

// POST /api/providers/:providerId/entries
app.post("/api/providers/:providerId/entries", async (req, res) => {
  try {
    const { providerId } = req.params;
    const provider = await getProviderOr404(res, providerId);
    if (!provider) return;

    const { start, end, status, title, reason } = req.body || {};
    const startD = new Date(start);
    const endD = new Date(end);
    if (!start || Number.isNaN(startD.getTime())) return fail(res, 400, "start must be a valid ISO datetime");
    if (!end || Number.isNaN(endD.getTime())) return fail(res, 400, "end must be a valid ISO datetime");
    if (endD <= startD) return fail(res, 400, "end must be after start");
    if (!["booked", "blocked"].includes(status)) {
      return fail(res, 400, "status must be 'booked' or 'blocked'");
    }

    const conflict = await pool.query(
      `SELECT id FROM calendar_entries
       WHERE provider_id = $1 AND start_time < $3::timestamptz AND end_time > $2::timestamptz LIMIT 1`,
      [providerId, startD.toISOString(), endD.toISOString()]
    );
    if (conflict.rows.length > 0) {
      return fail(res, 409, "SLOT_CONFLICT");
    }

    const { randomUUID } = require("crypto");
    const r = await pool.query(
      `INSERT INTO calendar_entries(id, provider_id, start_time, end_time, status, title, reason)
       VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7) RETURNING *`,
      [randomUUID(), providerId, startD.toISOString(), endD.toISOString(),
       status, title || null, reason || null]
    );
    return ok(res, r.rows[0], 201);
  } catch (e) {
    return handleError(res, e, "POST entries");
  }
});

// DELETE /api/entries/:entryId
app.delete("/api/entries/:entryId", async (req, res) => {
  try {
    const { entryId } = req.params;
    if (!isUuid(entryId)) return fail(res, 400, "Invalid entryId (must be a UUID)");
    const r = await pool.query("DELETE FROM calendar_entries WHERE id = $1 RETURNING id", [entryId]);
    if (r.rows.length === 0) return fail(res, 404, "Entry not found");
    return ok(res, { deleted: true, id: entryId });
  } catch (e) {
    return handleError(res, e, "DELETE entries");
  }
});

// 404 for unknown /api routes
app.use("/api", (req, res) => fail(res, 404, "Not found"));

app.listen(PORT, () => {
  console.log(`Team B Availability Engine running on http://localhost:${PORT}/api`);
});
