CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  specialty TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE(provider_id, day_of_week, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('booked', 'blocked')),
  title TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
  time_format TEXT NOT NULL DEFAULT '12' CHECK (time_format IN ('12', '24')),
  auto_refresh BOOLEAN NOT NULL DEFAULT TRUE,
  show_conflict_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  daily_summary BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_working_hours_provider_day
  ON working_hours(provider_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_provider_start
  ON calendar_entries(provider_id, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_provider_range
  ON calendar_entries(provider_id, start_time, end_time);

INSERT INTO settings(id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
