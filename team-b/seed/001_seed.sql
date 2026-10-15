-- Demo data matching the supplied Team B frontend.
INSERT INTO providers(id, name, specialty, active) VALUES
('11111111-1111-1111-1111-111111111111', 'Dr. Asha Patil', 'Cardiologist', TRUE),
('22222222-2222-2222-2222-222222222222', 'Dr. Rahul Sharma', 'General Physician', TRUE),
('33333333-3333-3333-3333-333333333333', 'Dr. Priya Deshmukh', 'Dermatologist', TRUE)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, specialty=EXCLUDED.specialty, active=EXCLUDED.active;

-- Monday-Friday, 09:00-17:00 local calendar time.
INSERT INTO working_hours(provider_id, day_of_week, start_time, end_time)
SELECT p.id, d.day, '09:00', '17:00'
FROM providers p
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(day)
ON CONFLICT DO NOTHING;

-- Frontend prototype sample: 29 Sep 2026.
-- Asha: 10:00-10:30 and 15:00-15:30 booked; 12:00-13:00 blocked.
INSERT INTO calendar_entries(id, provider_id, start_time, end_time, status, title, reason) VALUES
('aaaaaaaa-0001-0001-0001-000000000001','11111111-1111-1111-1111-111111111111','2026-09-29 10:00:00+05:30','2026-09-29 10:30:00+05:30','booked','Appointment','Patient appointment'),
('aaaaaaaa-0001-0001-0001-000000000002','11111111-1111-1111-1111-111111111111','2026-09-29 15:00:00+05:30','2026-09-29 15:30:00+05:30','booked','Appointment','Patient appointment'),
('aaaaaaaa-0001-0001-0001-000000000003','11111111-1111-1111-1111-111111111111','2026-09-29 12:00:00+05:30','2026-09-29 13:00:00+05:30','blocked','Break','Lunch break'),
('bbbbbbbb-0001-0001-0001-000000000001','22222222-2222-2222-2222-222222222222','2026-09-29 10:00:00+05:30','2026-09-29 10:30:00+05:30','booked','Appointment','Patient appointment'),
('cccccccc-0001-0001-0001-000000000001','33333333-3333-3333-3333-333333333333','2026-09-29 09:00:00+05:30','2026-09-29 09:30:00+05:30','blocked','Unavailable','Provider unavailable')
ON CONFLICT (id) DO NOTHING;
