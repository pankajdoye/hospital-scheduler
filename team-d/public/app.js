/* Team D integration console — vanilla JS, same-origin calls to the BFF. */
"use strict";

/* ---------- utils ---------- */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, ok: res.ok, body: json };
}

function showError(elId, msg) { $(elId).textContent = msg || ""; }
function showOk(elId, msg) { $(elId).textContent = msg || ""; }

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    const loaders = {
      appointments: loadBookings,
      patients: loadPatients,
      scheduling: loadSchedMetrics,
      analytics: loadAnalyticsDefaults,
      settings: loadSettings,
      audit: loadAudit,
    };
    if (loaders[btn.dataset.tab]) loaders[btn.dataset.tab]();
  });
});

/* ---------- health ---------- */
async function loadHealth() {
  try {
    const r = await api("/api/health");
    const d = (r.body && r.body.data) || {};
    setPill("health-bff", d.bff);
    setPill("health-teamA", d.teamA);
    setPill("health-teamB", d.teamB);
    setPill("health-teamC", d.teamC);
  } catch (_) {
    setPill("health-bff", "down");
  }
}
function setPill(id, state) {
  const el = $(id);
  const label = id.replace("health-", "").toUpperCase();
  const up = state === "up";
  el.className = "pill " + (up ? "up" : "down");
  el.textContent = `${label} ${up ? "up" : "down"}`;
}

/* ---------- providers ---------- */
let providers = [];

async function loadProviders() {
  try {
    const r = await api("/api/providers");
    if (r.ok && r.body.success) {
      providers = r.body.data;
      for (const selId of ["search-provider", "analytics-provider", "sched-provider"]) {
        const sel = $(selId);
        sel.innerHTML = "";
        providers.forEach((p) => {
          const o = document.createElement("option");
          o.value = p.id;
          o.textContent = `${p.name} — ${p.specialty}` +
            (selId === "sched-provider" && !p.teamA ? " (no Team A slots)" : "");
          sel.appendChild(o);
        });
      }
    }
  } catch (_) { /* banner shows the outage */ }
}
function providerName(id) {
  const p = providers.find((x) => x.id === id);
  return p ? p.name : id;
}

/* Refresh providers without a full page reload. The list is fetched once at
   page load; if Team B was down then, the dropdowns stay empty until this
   is clicked — same pattern as the Appointments Refresh button. */
$("reload-providers").addEventListener("click", async () => {
  const btn = $("reload-providers");
  btn.disabled = true;
  await loadProviders();
  btn.disabled = false;
  if (!providers.length) {
    showError("search-error", "Providers still not loaded — check the Team B pill in the banner above, then try Refresh again.");
  } else {
    showError("search-error", "");
  }
});

/* ---------- search & book ---------- */
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("search-error", "");
  $("slots").innerHTML = "";
  const providerId = $("search-provider").value;
  const q = new URLSearchParams({
    dateFrom: $("search-from").value,
    dateTo: $("search-to").value,
    durationMinutes: $("search-duration").value || "30",
    timePreference: $("search-pref").value,
  });
  try {
    const r = await api(`/api/providers/${encodeURIComponent(providerId)}/availability?${q}`);
    if (!r.ok || !r.body.success) {
      showError("search-error", (r.body && r.body.error) || `Search failed (HTTP ${r.status})`);
      return;
    }
    const slots = r.body.data.slots || [];
    if (slots.length === 0) {
      $("slots").innerHTML = "<p class='note'>No free slots in this range.</p>";
      return;
    }
    slots.forEach((s) => {
      const card = document.createElement("div");
      card.className = "slot-card";
      card.innerHTML =
        `<div class="date">${esc(s.date)}</div><div class="time">${esc(s.start)}–${esc(s.end)}</div>` +
        `<button type="button">Book</button>`;
      card.querySelector("button").addEventListener("click", () =>
        openBookModal(providerId, s.date, s.start, s.end));
      $("slots").appendChild(card);
    });
  } catch (err) {
    showError("search-error", "BFF unreachable: " + err.message);
  }
});

let pendingSlot = null;
function openBookModal(providerId, date, start, end) {
  pendingSlot = { providerId, date, start };
  $("book-slot-summary").textContent =
    `${providerName(providerId)} · ${date} · ${start}–${end}`;
  showError("book-error", "");
  showOk("book-ok", "");
  const sel = $("book-patient");
  sel.innerHTML = "";
  patients.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.user_id;
    o.textContent = `${p.full_name} (#${p.user_id})`;
    sel.appendChild(o);
  });
  $("book-modal").classList.remove("hidden");
}
$("book-cancel").addEventListener("click", () => $("book-modal").classList.add("hidden"));

$("book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("book-error", "");
  showOk("book-ok", "");
  try {
    const r = await api("/api/bookings", {
      method: "POST",
      body: {
        providerId: pendingSlot.providerId,
        patientId: Number($("book-patient").value),
        date: pendingSlot.date,
        startTime: pendingSlot.start,
        purpose: $("book-purpose").value,
      },
    });
    if (!r.ok || !r.body.success) {
      const msg = (r.body && r.body.error) || `Booking failed (HTTP ${r.status})`;
      showError("book-error", /SLOT_CONFLICT/.test(msg)
        ? "Slot conflict — someone just took this slot. Pick another."
        : msg);
      return;
    }
    const d = r.body.data || {};
    showOk("book-ok", `Booked! Appointment #${d.appointment_id} — ${d.state || ""}`);
    loadBookings();
  } catch (err) {
    showError("book-error", "BFF unreachable: " + err.message);
  }
});

/* ---------- appointments ---------- */
$("reload-bookings").addEventListener("click", loadBookings);

async function loadBookings() {
  showError("bookings-error", "");
  try {
    const r = await api("/api/bookings");
    if (!r.ok || !r.body.success) {
      showError("bookings-error", (r.body && r.body.error) || `Load failed (HTTP ${r.status})`);
      return;
    }
    const body = $("bookings-body");
    body.innerHTML = "";
    (r.body.data || []).forEach((b) => {
      const tr = document.createElement("tr");
      const cancellable = b.state === "CONFIRMED" || b.state === "BOOKED";
      tr.innerHTML =
        `<td>${esc(b.appointment_id)}</td><td>${esc(b.patient)}</td><td>${esc(b.provider)}</td>` +
        `<td>${esc(b.start)}</td><td>${esc(b.state)}</td><td>${esc(b.purpose)}</td>` +
        `<td>${cancellable ? `<button class="cancel" data-id="${esc(b.appointment_id)}">Cancel</button>` : ""}</td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll("button.cancel").forEach((btn) =>
      btn.addEventListener("click", () => cancelBooking(btn.dataset.id)));
  } catch (err) {
    showError("bookings-error", "BFF unreachable: " + err.message);
  }
}

async function cancelBooking(id) {
  if (!window.confirm(`Cancel appointment #${id}?`)) return;
  try {
    const r = await api(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (!r.ok || !r.body.success) {
      showError("bookings-error", (r.body && r.body.error) || `Cancel failed (HTTP ${r.status})`);
      return;
    }
    loadBookings();
  } catch (err) {
    showError("bookings-error", "BFF unreachable: " + err.message);
  }
}

/* ---------- patients ---------- */
let patients = [];

$("patient-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("patient-error", "");
  try {
    const r = await api("/api/patients", {
      method: "POST",
      body: {
        fullName: $("p-name").value.trim(),
        gender: $("p-gender").value.trim(),
        dateOfBirth: $("p-dob").value,
        phone: $("p-phone").value.trim(),
        email: $("p-email").value.trim(),
        address: $("p-address").value.trim(),
      },
    });
    if (!r.ok || !r.body.success) {
      showError("patient-error", (r.body && r.body.error) || `Registration failed (HTTP ${r.status})`);
      return;
    }
    $("patient-form").reset();
    loadPatients();
  } catch (err) {
    showError("patient-error", "BFF unreachable: " + err.message);
  }
});

async function loadPatients() {
  showError("patient-error", "");
  try {
    const r = await api("/api/patients");
    if (!r.ok || !r.body.success) {
      showError("patient-error", (r.body && r.body.error) || `Load failed (HTTP ${r.status})`);
      return;
    }
    patients = r.body.data || [];
    const body = $("patients-body");
    body.innerHTML = "";
    patients.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(p.user_id)}</td><td>${esc(p.full_name)}</td><td>${esc(p.gender)}</td>` +
        `<td>${esc(p.date_of_birth)}</td><td>${esc(p.phone)}</td><td>${esc(p.email)}</td>`;
      body.appendChild(tr);
    });
  } catch (err) {
    showError("patient-error", "BFF unreachable: " + err.message);
  }
}

/* ---------- scheduling ---------- */
$("sched-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("sched-error", "");
  const providerId = $("sched-provider").value;
  const policy = $("sched-policy").value;
  try {
    const r = await api("/api/scheduling/run", {
      method: "POST",
      body: { providerId, policy },
    });
    if (!r.ok || !r.body.success) {
      showError("sched-error", (r.body && r.body.error) || `Run failed (HTTP ${r.status})`);
      return;
    }
    const d = r.body.data || {};
    const rows = Array.isArray(d) ? d : d.data || [];
    const body = $("sched-queue-body");
    body.innerHTML = "";
    rows.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(b.queue_position)}</td><td>${esc(b.request_id)}</td><td>${esc(b.priority)}</td>` +
        `<td>${esc(b.state)}</td><td>${esc(b.assigned_slot_id || "—")}</td><td>${esc(b.estimated_start || "—")}</td>`;
      body.appendChild(tr);
    });
    loadSchedMetrics();
  } catch (err) {
    showError("sched-error", "BFF unreachable: " + err.message);
  }
});

async function loadSchedMetrics() {
  try {
    const r = await api("/api/metrics/scheduling");
    if (!r.ok || !r.body.success) return;
    const m = r.body.data || {};
    const cards = [
      ["Total requests", m.total_requests],
      ["Scheduled", m.scheduled_count],
      ["Waitlisted", m.waitlisted_count],
      ["Lock conflicts", m.lock_conflicts],
      ["Active locks", m.active_locks],
      ["Scheduler runs", m.scheduling_runs],
    ];
    $("sched-metrics").innerHTML = cards
      .map(([l, v]) => `<div class="card"><div class="label">${esc(l)}</div><div class="value">${esc(v == null ? "—" : v)}</div></div>`)
      .join("");
  } catch (_) { /* banner shows the outage */ }
}

/* ---------- analytics ---------- */
function loadAnalyticsDefaults() {
  if (!$("analytics-from").value) $("analytics-from").value = localDateStr(-30);
  if (!$("analytics-to").value) $("analytics-to").value = localDateStr();
}

$("analytics-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("analytics-error", "");
  const providerId = $("analytics-provider").value;
  const from = $("analytics-from").value;
  const to = $("analytics-to").value;
  try {
    const a = await api(`/api/providers/${encodeURIComponent(providerId)}/analytics?from=${from}&to=${to}`);
    if (!a.ok || !a.body.success) {
      showError("analytics-error", (a.body && a.body.error) || `Analytics failed (HTTP ${a.status})`);
      return;
    }
    const d = a.body.data || {};
    $("analytics-cards").innerHTML = [
      ["Booked", d.totalBooked], ["Blocked", d.totalBlocked],
      ["Utilization %", d.utilizationPct], ["Busiest date", d.busiestDate || "—"],
    ].map(([l, v]) => `<div class="card"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join("");

    const rep = await api(`/api/reports?from=${from}&to=${to}`);
    if (rep.ok && rep.body.success) {
      const rows = rep.body.data || [];
      const max = Math.max(1, ...rows.map((x) => x.booked + x.blocked));
      $("report-bars").innerHTML = rows.map((x) => {
        const bw = Math.round((x.booked / max) * 100);
        const kw = Math.round((x.blocked / max) * 100);
        return `<div class="bar-row"><span class="day">${esc(x.date)}</span>` +
          `<span class="track"><span class="fill-booked" style="width:${bw}%"></span>` +
          `<span class="fill-blocked" style="left:${bw}%;width:${kw}%"></span></span>` +
          `<span class="nums">${x.booked} booked · ${x.blocked} blocked</span></div>`;
      }).join("");
    }
  } catch (err) {
    showError("analytics-error", "BFF unreachable: " + err.message);
  }
});

/* ---------- settings ---------- */
async function loadSettings() {
  showError("settings-error", "");
  showOk("settings-ok", "");
  try {
    const r = await api("/api/settings");
    if (!r.ok || !r.body.success) {
      showError("settings-error", (r.body && r.body.error) || `Load failed (HTTP ${r.status})`);
      return;
    }
    const s = r.body.data || {};
    $("s-duration").value = s.default_duration_minutes || 30;
    $("s-timeformat").value = String(s.time_format || "12");
    $("s-autorefresh").checked = !!s.auto_refresh;
    $("s-conflicts").checked = !!s.show_conflict_alerts;
    $("s-summary").checked = !!s.daily_summary;
  } catch (err) {
    showError("settings-error", "BFF unreachable: " + err.message);
  }
}

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("settings-error", "");
  showOk("settings-ok", "");
  try {
    const r = await api("/api/settings", {
      method: "PUT",
      body: {
        default_duration_minutes: Number($("s-duration").value),
        time_format: $("s-timeformat").value,
        auto_refresh: $("s-autorefresh").checked,
        show_conflict_alerts: $("s-conflicts").checked,
        daily_summary: $("s-summary").checked,
      },
    });
    if (!r.ok || !r.body.success) {
      showError("settings-error", (r.body && r.body.error) || `Save failed (HTTP ${r.status})`);
      return;
    }
    showOk("settings-ok", "Settings saved.");
  } catch (err) {
    showError("settings-error", "BFF unreachable: " + err.message);
  }
});

/* ---------- audit ---------- */
$("reload-audit").addEventListener("click", loadAudit);

async function loadAudit() {
  showError("audit-error", "");
  try {
    const r = await api("/api/audit");
    if (!r.ok || !r.body.success) {
      showError("audit-error", (r.body && r.body.error) || `Load failed (HTTP ${r.status}) — admin token required.`);
      return;
    }
    const body = $("audit-body");
    body.innerHTML = "";
    (r.body.data || []).forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(a.audit_id)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td>` +
        `<td>${esc(a.table)}</td><td>${esc(a.record_id)}</td>` +
        `<td><code>${esc(a.correlation_id)}</code></td><td>${esc(a.created_at)}</td>`;
      body.appendChild(tr);
    });
  } catch (err) {
    showError("audit-error", "BFF unreachable: " + err.message);
  }
}

/* ---------- init ---------- */
$("search-from").value = localDateStr();
$("search-to").value = localDateStr(7);
loadHealth();
loadProviders();
loadPatients();
