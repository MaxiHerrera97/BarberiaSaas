-- Pago previo de turnos por tenant (opcional)

ALTER TABLE tenants
  ADD COLUMN booking_payment_required TINYINT(1) NOT NULL DEFAULT 0 AFTER multi_branch_enabled,
  ADD COLUMN booking_payment_provider ENUM('none', 'mercado_pago') NOT NULL DEFAULT 'none' AFTER booking_payment_required,
  ADD COLUMN booking_mp_access_token VARCHAR(255) NULL AFTER booking_payment_provider,
  ADD COLUMN booking_mp_collector_id BIGINT UNSIGNED NULL AFTER booking_mp_access_token;

CREATE TABLE IF NOT EXISTS appointment_payment_intents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  hold_token CHAR(36) NOT NULL,
  external_reference VARCHAR(140) NOT NULL,
  mp_preference_id VARCHAR(80) NOT NULL,
  mp_payment_id VARCHAR(80) NULL,
  amount_ars INT UNSIGNED NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  checkout_url VARCHAR(500) NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointment_payment_external_reference (external_reference),
  UNIQUE KEY uq_appointment_payment_hold_token (tenant_id, hold_token),
  KEY idx_appointment_payment_tenant_status_created (tenant_id, status, created_at),
  CONSTRAINT fk_appointment_payment_intents_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
