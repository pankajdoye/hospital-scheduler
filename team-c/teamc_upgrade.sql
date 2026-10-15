-- Team C DBMS upgrade: run after the existing hospital_management schema.
-- MySQL 8.x. This migration is additive and safe to run more than once.
USE hospital_management;

CREATE TABLE IF NOT EXISTS teamc_idempotency_keys (
    idempotency_key VARCHAR(120) PRIMARY KEY,
    endpoint VARCHAR(180) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status INT NOT NULL,
    response_body JSON NOT NULL,
    appointment_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_teamc_idempotency_endpoint (idempotency_key, endpoint),
    CONSTRAINT fk_teamc_idempotency_appointment FOREIGN KEY (appointment_id)
        REFERENCES appointments(appointment_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS teamc_audit_log (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor VARCHAR(120) NOT NULL,
    action_name VARCHAR(80) NOT NULL,
    table_name VARCHAR(80) NOT NULL,
    record_id VARCHAR(80) NOT NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    correlation_id VARCHAR(120) NOT NULL,
    source_service VARCHAR(80) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_teamc_audit_correlation (correlation_id),
    INDEX idx_teamc_audit_record (table_name, record_id),
    INDEX idx_teamc_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS teamc_outbox (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    payload JSON NOT NULL,
    correlation_id VARCHAR(120) NOT NULL,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL,
    INDEX idx_teamc_outbox_unpublished (published, created_at)
);

CREATE TABLE IF NOT EXISTS teamc_recovery_checks (
    recovery_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    backup_file VARCHAR(255) NOT NULL,
    backup_created_at DATETIME NULL,
    restore_started_at DATETIME NULL,
    restore_completed_at DATETIME NULL,
    row_count_before BIGINT NULL,
    row_count_after BIGINT NULL,
    status ENUM('STARTED','PASSED','FAILED') NOT NULL,
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Helpful indexes for Team C range and conflict queries.
CREATE INDEX idx_appointments_doctor_date_time
    ON appointments (doctor_id, appointment_date, appointment_time);
CREATE INDEX idx_appointments_status_date
    ON appointments (status, appointment_date);
CREATE INDEX idx_doctors_available
    ON doctors (available);

-- Optional provider-calendar table used by the calendar contract.
CREATE TABLE IF NOT EXISTS provider_calendar_intervals (
    interval_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    interval_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    interval_type ENUM('WORKING','BLOCKED') NOT NULL,
    reason VARCHAR(255) NULL,
    calendar_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_calendar_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    CONSTRAINT chk_calendar_time CHECK (end_time > start_time),
    INDEX idx_calendar_doctor_date (doctor_id, interval_date)
);
