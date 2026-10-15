-- Team C base schema for the Hospital Online Appointment System.
-- Run this FIRST, then teamc_upgrade.sql (which adds idempotency, audit,
-- outbox, recovery evidence, provider-calendar intervals and indexes).
-- MySQL 8.x. Safe to run more than once (all statements are IF NOT EXISTS,
-- the seed INSERT is guarded by a row-count check).

CREATE DATABASE IF NOT EXISTS hospital_management;
USE hospital_management;

CREATE TABLE IF NOT EXISTS doctors (
  doctor_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  specialization VARCHAR(120) DEFAULT '',
  phone VARCHAR(20) DEFAULT '',
  email VARCHAR(120) DEFAULT '',
  room_no VARCHAR(20) DEFAULT '',
  available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS patients (
  patient_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  gender VARCHAR(20) DEFAULT '',
  date_of_birth DATE NULL,
  phone VARCHAR(20) DEFAULT '',
  email VARCHAR(120) DEFAULT '',
  address VARCHAR(255) DEFAULT ''
);

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  reason VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  CONSTRAINT fk_appt_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id),
  UNIQUE KEY uq_doctor_slot (doctor_id, appointment_date, appointment_time)
);

-- Seed doctors. Names match the Team B Postgres seed so the Team D BFF can
-- map providers by name across teams.
INSERT INTO doctors (full_name, specialization, phone, email, room_no, available)
SELECT * FROM (
  SELECT 'Dr. Asha Patil' AS full_name, 'Cardiologist' AS specialization,
         '9876543210' AS phone, 'asha.patil@gmail.com' AS email,
         '101' AS room_no, TRUE AS available
  UNION ALL SELECT 'Dr. Rahul Sharma', 'General Physician', '9876543211', 'rahul.sharma@gmail.com', '102', TRUE
  UNION ALL SELECT 'Dr. Priya Deshmukh', 'Dermatologist', '9876543212', 'priya.deshmukh@gmail.com', '103', TRUE
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM doctors);
