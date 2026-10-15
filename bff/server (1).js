/**
 * Team D — Backend for Frontend (BFF), port 4000.
 * Fans out to Team A (scheduling :3001), Team B (availability :3000),
 * Team C (authoritative data :8080) and normalizes everything to:
 *   {"success": true, "data": ...}  /  {"success": false, "error": "..."}
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

const PORT = Number(process.env.BFF_PORT) || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- downstream call helpers ----------

async function callService(base, p, { method = "GET", body, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.DOWNSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    return { down: true, error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

function down(res, team) {
  return res.status(502).json({ success: false, error: `${team} unavailable` });
}

// Team B envelope is already {success, data|error}; pass through, keep status.
function fromTeamB(res, r) {
  if (r.down) return down(res, "team-b");
  const status = r.status || 500;
  if (r.json && typeof r.json.success === "boolean") return res.status(status).json(r.json);
  return res.status(status).json({ success: r.ok, data: r.json, error: r.ok ? undefined : r.text });
}

// Team A is ad-hoc ({message,data} / {error:{message}}); normalize.
function fromTeamA(res, r) {
  if (r.down) return down(res, "team-a");
  const status = r.status || 500;
  if (r.ok) {
    const data = r.json && r.json.data !== undefined ? r.json.data : r.json;
    return res.status(status).json({ success: true, data });
  }
  const msg =
    (r.json && r.json.error && r.json.error.message) ||
    (r.json && r.json.error) ||
    r.text ||
    "Team A request failed";
  return res.status(status).json({ success: false, error: String(msg) });
}

// Team C envelope: {data, meta} / {error:{code,message}, meta}; unwrap.
function fromTeamC(res, r) {
  if (r.down) return down(res, "team-c");
  const status = r.status || 500;
  if (r.ok) {
    const data = r.json && "data" in r.json ? r.json.data : r.json;
    return res.status(status).json({ success: true, data });
  }
  const err = r.json && r.json.error;
  const msg = err ? `${err.code || "ERROR"}: ${err.message || ""}`.trim() : r.text || "Team C request failed";
  return res.status(status).json({ success: false, error: msg });
}

function teamCHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${config.TEAM_C_TOKEN}`,
    "X-Correlation-ID": crypto.randomUUID(),
    ...extra,
  };
}

function mapProvider(bffId) {
  return config.PROVIDER_MAP.find((m) => m.bff === bffId) || null;
}

// ---------- health ----------

app.get("/api/health", async (req, res) => {
  const [a, b, c] = await Promise.all([
    callService(config.TEAM_A_URL, "/"),
    callService(config.TEAM_B_URL, "/api/health"),
    callService(config.TEAM_C_URL, "/api/v1/health"),
  ]);
  res.json({
    success: true,
    data: {
      bff: "up",
      teamA: a.down ? "down" : "up",
      teamB: b.down ? "down" : "up",
      teamC: c.down ? "down" : "up",
    },
  });
});

// ---------- providers (Team B, enriched with cross-team ids) ----------

app.get("/api/providers", async (req, res) => {
  const r = await callService(config.TEAM_B_URL, "/api/providers");
  if (r.down) return down(res, "team-b");
  if (!r.ok || !r.json || !r.json.success) return fromTeamB(res, r);
  const enriched = r.json.data.map((p) => {
    const m = mapProvider(p.id);
    return { ...p, teamC: m ? m.teamC : null, teamA: m ? m.teamA : null };
  });
  return res.json({ success: true, data: enriched });
});

// ---------- availability / calendar / analytics / reports / settings / entries (Team B passthrough) ----------

function teamBPassthrough(method) {
  return async (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const upstreamPath = "/api" + req.path.replace(/^\/api/, "") + qs;
    const r = await callService(config.TEAM_B_URL, upstreamPath, {
      method,
      body: ["POST", "PUT"].includes(method) ? req.body : undefined,
    });
    return fromTeamB(res, r);
  };
}

app.get("/api/providers/:id/availability", async (req, res) => {
  const { dateFrom, dateTo, durationMinutes, timePreference } = req.query;
  const r = await callService(config.TEAM_B_URL, "/api/availability/search", {
    method: "POST",
    body: {
      providerId: req.params.id,
      dateFrom,
      dateTo,
      durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
      timePreference,
    },
  });
  return fromTeamB(res, r);
});

app.get("/api/providers/:id/calendar", teamBPassthrough("GET"));
app.get("/api/providers/:id/slot-lookup", teamBPassthrough("GET"));
app.get("/api/providers/:id/analytics", teamBPassthrough("GET"));
app.get("/api/reports", teamBPassthrough("GET"));
app.get("/api/settings", teamBPassthrough("GET"));
app.put("/api/settings", teamBPassthrough("PUT"));
app.post("/api/providers/:id/entries", teamBPassthrough("POST"));
app.delete("/api/entries/:entryId", teamBPassthrough("DELETE"));

// ---------- patients (Team C) ----------

app.get("/api/patients", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, "/api/v1/patients", {
    headers: teamCHeaders(),
  });
  return fromTeamC(res, r);
});

app.post("/api/patients", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, "/api/v1/patients", {
    method: "POST",
    headers: teamCHeaders(),
    body: req.body,
  });
  return fromTeamC(res, r);
});

// ---------- bookings (Team C authoritative) ----------

app.get("/api/bookings", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, "/api/v1/appointments", {
    headers: teamCHeaders(),
  });
  return fromTeamC(res, r);
});

app.get("/api/bookings/:id", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, `/api/v1/appointments/${encodeURIComponent(req.params.id)}`, {
    headers: teamCHeaders(),
  });
  return fromTeamC(res, r);
});

app.post("/api/bookings", async (req, res) => {
  const { providerId, patientId, date, startTime, purpose } = req.body || {};
  if (!providerId || !patientId || !date || !startTime) {
    return res.status(400).json({
      success: false,
      error: "providerId, patientId, date and startTime are required",
    });
  }
  const m = mapProvider(providerId);
  if (!m) {
    return res.status(400).json({ success: false, error: "Unknown providerId" });
  }
  const r = await callService(config.TEAM_C_URL, "/api/v1/appointments", {
    method: "POST",
    headers: teamCHeaders({ "Idempotency-Key": crypto.randomUUID() }),
    body: {
      userId: Number(patientId),
      providerId: m.teamC,
      date,
      startTime,
      purpose: purpose || "",
    },
  });
  return fromTeamC(res, r);
});

app.post("/api/bookings/:id/cancel", async (req, res) => {
  const r = await callService(
    config.TEAM_C_URL,
    `/api/v1/appointments/${encodeURIComponent(req.params.id)}/cancel`,
    { method: "POST", headers: teamCHeaders() }
  );
  return fromTeamC(res, r);
});

// ---------- team C read models ----------

app.get("/api/teamc-providers/:teamCId/calendar", async (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const r = await callService(
    config.TEAM_C_URL,
    `/api/v1/providers/${encodeURIComponent(req.params.teamCId)}/calendar${qs}`,
    { headers: teamCHeaders() }
  );
  return fromTeamC(res, r);
});

app.get("/api/audit", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, "/api/v1/audit", {
    headers: teamCHeaders(),
  });
  return fromTeamC(res, r);
});

app.get("/api/utilization", async (req, res) => {
  const r = await callService(config.TEAM_C_URL, "/api/v1/reports/utilization", {
    headers: teamCHeaders(),
  });
  return fromTeamC(res, r);
});

// ---------- scheduling (Team A) ----------

function teamAIdOr501(res, bffId) {
  const m = mapProvider(bffId);
  if (!m) {
    res.status(400).json({ success: false, error: "Unknown providerId" });
    return null;
  }
  if (!m.teamA) {
    res.status(501).json({
      success: false,
      error: "scheduling not configured for this provider in Team A",
    });
    return null;
  }
  return m.teamA;
}

app.get("/api/scheduling/queue", async (req, res) => {
  const { providerId, policy } = req.query;
  if (!providerId) return res.status(400).json({ success: false, error: "providerId is required" });
  const teamAId = teamAIdOr501(res, providerId);
  if (!teamAId) return;
  const r = await callService(
    config.TEAM_A_URL,
    `/api/v1/providers/${encodeURIComponent(teamAId)}/queue?policy=${encodeURIComponent(policy || "FCFS")}`
  );
  return fromTeamA(res, r);
});

app.post("/api/scheduling/requests", async (req, res) => {
  const body = { ...(req.body || {}) };
  if (!body.provider_id) {
    return res.status(400).json({ success: false, error: "provider_id is required" });
  }
  const teamAId = teamAIdOr501(res, body.provider_id);
  if (!teamAId) return;
  body.provider_id = teamAId;
  const r = await callService(config.TEAM_A_URL, "/api/v1/scheduling/requests", {
    method: "POST",
    body,
  });
  return fromTeamA(res, r);
});

app.post("/api/scheduling/run", async (req, res) => {
  const { providerId, policy } = req.body || {};
  if (!providerId || !policy) {
    return res.status(400).json({ success: false, error: "providerId and policy are required" });
  }
  const teamAId = teamAIdOr501(res, providerId);
  if (!teamAId) return;
  const r = await callService(config.TEAM_A_URL, "/internal/v1/scheduler/run", {
    method: "POST",
    body: { provider_id: teamAId, policy },
  });
  return fromTeamA(res, r);
});

app.get("/api/scheduling/decisions/:decisionId", async (req, res) => {
  const r = await callService(
    config.TEAM_A_URL,
    `/api/v1/scheduling/decisions/${encodeURIComponent(req.params.decisionId)}`
  );
  return fromTeamA(res, r);
});

app.get("/api/metrics/scheduling", async (req, res) => {
  const r = await callService(config.TEAM_A_URL, "/api/v1/metrics/scheduling");
  return fromTeamA(res, r);
});

// SPA fallback (after /api routes so it never swallows them)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Team D BFF running on http://localhost:${PORT}`);
  console.log(`  Team A: ${config.TEAM_A_URL}`);
  console.log(`  Team B: ${config.TEAM_B_URL}`);
  console.log(`  Team C: ${config.TEAM_C_URL}`);
});
