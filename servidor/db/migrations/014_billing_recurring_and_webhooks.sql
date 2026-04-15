-- Fase 2: soporte de suscripcion mensual y webhook idempotente Mercado Pago

ALTER TABLE tenants
  ADD COLUMN mp_subscription_id VARCHAR(80) NULL AFTER trial_ends_at,
  ADD COLUMN mp_subscription_status VARCHAR(40) NULL AFTER mp_subscription_id,
  ADD COLUMN mp_subscription_started_at DATETIME NULL AFTER mp_subscription_status,
  ADD COLUMN mp_subscription_updated_at DATETIME NULL AFTER mp_subscription_started_at;

CREATE TABLE IF NOT EXISTS tenant_billing_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(30) NOT NULL,
  event_key VARCHAR(140) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  event_id VARCHAR(80) NOT NULL,
  status ENUM('processing', 'processed', 'failed', 'ignored') NOT NULL DEFAULT 'processing',
  attempts_count INT UNSIGNED NOT NULL DEFAULT 1,
  last_error VARCHAR(255) NULL,
  payload_json JSON NULL,
  processed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_billing_webhook_event_key (event_key),
  KEY idx_tenant_billing_webhook_status_created (status, created_at)
);

