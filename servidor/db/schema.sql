CREATE DATABASE IF NOT EXISTS tu_estilo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tu_estilo;

CREATE TABLE IF NOT EXISTS tenants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  plan ENUM('free', 'basic', 'pro') NOT NULL DEFAULT 'free',
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  trial_active TINYINT(1) NOT NULL DEFAULT 0,
  trial_starts_at DATETIME NULL,
  trial_ends_at DATETIME NULL,
  mp_subscription_id VARCHAR(80) NULL,
  mp_subscription_status VARCHAR(40) NULL,
  mp_subscription_started_at DATETIME NULL,
  mp_subscription_updated_at DATETIME NULL,
  multi_branch_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug)
);

CREATE TABLE IF NOT EXISTS branches (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_tenant_slug (tenant_id, slug),
  KEY idx_branches_tenant_active (tenant_id, is_active),
  CONSTRAINT fk_branches_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_billing_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  billing_month CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  amount_ars INT UNSIGNED NOT NULL DEFAULT 30000,
  payment_method ENUM('transferencia', 'mercado_pago', 'efectivo') NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(255) NULL,
  recorded_by VARCHAR(80) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_billing_month (tenant_id, billing_month),
  KEY idx_tenant_billing_paid_at (tenant_id, paid_at),
  CONSTRAINT fk_tenant_billing_payments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

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

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_username VARCHAR(80) NOT NULL,
  action VARCHAR(80) NOT NULL,
  tenant_id INT UNSIGNED NULL,
  target_user_id INT UNSIGNED NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_platform_audit_created_at (created_at),
  KEY idx_platform_audit_tenant (tenant_id),
  CONSTRAINT fk_platform_audit_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_platform_audit_user
    FOREIGN KEY (target_user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

INSERT INTO tenants (slug, name, plan, status, timezone)
VALUES ('tu-estilo-default', 'Tu Estilo - Barberia', 'free', 'active', 'America/Argentina/Buenos_Aires')
ON DUPLICATE KEY UPDATE
  name = VALUES(name);

INSERT INTO branches (tenant_id, name, slug, is_active)
SELECT t.id, 'Sucursal Principal', 'principal', 1
FROM tenants t
LEFT JOIN branches b ON b.tenant_id = t.id AND b.slug = 'principal'
WHERE b.id IS NULL;

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INT UNSIGNED NOT NULL,
  brand_name VARCHAR(120) NOT NULL,
  tagline VARCHAR(255) NULL,
  contact_phone VARCHAR(25) NULL,
  contact_whatsapp VARCHAR(25) NULL,
  contact_instagram VARCHAR(80) NULL,
  address VARCHAR(255) NULL,
  logo_url VARCHAR(500) NULL,
  hero_mode ENUM('generic', 'custom') NOT NULL DEFAULT 'generic',
  hero_slide_1_image_url VARCHAR(500) NULL,
  hero_slide_1_title VARCHAR(120) NULL,
  hero_slide_1_subtitle VARCHAR(255) NULL,
  hero_slide_2_image_url VARCHAR(500) NULL,
  hero_slide_2_title VARCHAR(120) NULL,
  hero_slide_2_subtitle VARCHAR(255) NULL,
  hero_slide_3_image_url VARCHAR(500) NULL,
  hero_slide_3_title VARCHAR(120) NULL,
  hero_slide_3_subtitle VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_tenant_settings_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS business_hours (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL COMMENT '0=Dom, 1=Lun ... 6=Sab',
  is_closed TINYINT(1) NOT NULL DEFAULT 0,
  open1 TIME NULL,
  close1 TIME NULL,
  open2 TIME NULL,
  close2 TIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_hours_tenant_day (tenant_id, day_of_week),
  KEY idx_business_hours_tenant (tenant_id),
  CONSTRAINT fk_business_hours_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_gallery (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  caption VARCHAR(140) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenant_gallery_tenant_active_order (tenant_id, is_active, sort_order, id),
  CONSTRAINT fk_tenant_gallery_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT INTO tenant_settings (
  tenant_id,
  brand_name,
  logo_url,
  hero_slide_1_image_url,
  hero_slide_1_title,
  hero_slide_1_subtitle,
  hero_slide_2_image_url,
  hero_slide_2_title,
  hero_slide_2_subtitle,
  hero_slide_3_image_url,
  hero_slide_3_title,
  hero_slide_3_subtitle
)
SELECT
  t.id,
  t.name,
  NULL,
  NULL,
  t.name,
  'Cortes modernos, clasicos y afeitado premium.',
  NULL,
  CONCAT('Atencion personalizada en ', t.name),
  'Elegi tu barbero y reserva en minutos.',
  NULL,
  'Experiencia completa',
  'Detalles, estilo y precision en cada turno.'
FROM tenants t
LEFT JOIN tenant_settings s ON s.tenant_id = t.id
WHERE s.tenant_id IS NULL;

INSERT INTO business_hours (tenant_id, day_of_week, is_closed, open1, close1, open2, close2)
SELECT
  t.id,
  d.day_of_week,
  CASE WHEN d.day_of_week = 0 THEN 1 ELSE 0 END AS is_closed,
  CASE
    WHEN d.day_of_week BETWEEN 1 AND 4 THEN '09:30:00'
    WHEN d.day_of_week IN (5, 6) THEN '09:30:00'
    ELSE NULL
  END AS open1,
  CASE
    WHEN d.day_of_week BETWEEN 1 AND 4 THEN '13:00:00'
    WHEN d.day_of_week IN (5, 6) THEN '14:00:00'
    ELSE NULL
  END AS close1,
  CASE
    WHEN d.day_of_week BETWEEN 1 AND 4 THEN '18:00:00'
    WHEN d.day_of_week IN (5, 6) THEN '16:00:00'
    ELSE NULL
  END AS open2,
  CASE
    WHEN d.day_of_week BETWEEN 1 AND 4 THEN '21:30:00'
    WHEN d.day_of_week IN (5, 6) THEN '22:00:00'
    ELSE NULL
  END AS close2
FROM tenants t
CROSS JOIN (
  SELECT 0 AS day_of_week UNION ALL
  SELECT 1 UNION ALL
  SELECT 2 UNION ALL
  SELECT 3 UNION ALL
  SELECT 4 UNION ALL
  SELECT 5 UNION ALL
  SELECT 6
) d
LEFT JOIN business_hours h
  ON h.tenant_id = t.id AND h.day_of_week = d.day_of_week
WHERE h.id IS NULL;

CREATE TABLE IF NOT EXISTS barbers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_barbers_tenant (tenant_id),
  KEY idx_barbers_branch (branch_id),
  CONSTRAINT fk_barbers_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_barbers_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS barber_business_hours (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  barber_id INT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL COMMENT '0=Dom, 1=Lun ... 6=Sab',
  is_closed TINYINT(1) NOT NULL DEFAULT 0,
  open1 TIME NULL,
  close1 TIME NULL,
  open2 TIME NULL,
  close2 TIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_barber_business_hours_day (barber_id, day_of_week),
  KEY idx_barber_business_hours_tenant_barber (tenant_id, barber_id),
  CONSTRAINT fk_barber_business_hours_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_barber_business_hours_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS barber_schedule_exceptions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  barber_id INT UNSIGNED NOT NULL,
  date_value DATE NOT NULL,
  is_closed TINYINT(1) NOT NULL DEFAULT 0,
  open1 TIME NULL,
  close1 TIME NULL,
  open2 TIME NULL,
  close2 TIME NULL,
  note VARCHAR(140) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_barber_schedule_exception_day (barber_id, date_value),
  KEY idx_barber_schedule_exceptions_tenant_barber_date (tenant_id, barber_id, date_value),
  CONSTRAINT fk_barber_schedule_exceptions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_barber_schedule_exceptions_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS services (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  price_ars INT UNSIGNED NOT NULL,
  duration_min INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_services_tenant (tenant_id),
  CONSTRAINT fk_services_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NULL,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'barber') NOT NULL,
  barber_id INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tenant_username (tenant_id, username),
  KEY idx_users_tenant (tenant_id),
  KEY idx_users_branch_id (branch_id),
  KEY idx_users_barber_id (barber_id),
  CONSTRAINT fk_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_users_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_users_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  barber_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  service_name_snapshot VARCHAR(120) NULL,
  service_price_ars_snapshot INT UNSIGNED NULL,
  service_duration_min_snapshot INT UNSIGNED NULL,
  barber_commission_pct_snapshot DECIMAL(5,2) NULL,
  barber_commission_ars_snapshot INT UNSIGNED NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status ENUM('pending', 'in_progress', 'done', 'no_show', 'cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_appointments_tenant_branch_start (tenant_id, branch_id, start_at),
  KEY idx_appointments_tenant_barber_start (tenant_id, barber_id, start_at),
  KEY idx_appointments_tenant_status_start (tenant_id, status, start_at),
  CONSTRAINT fk_appointments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointments_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointments_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointments_service
    FOREIGN KEY (service_id) REFERENCES services(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS appointment_holds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  barber_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  hold_token CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointment_holds_token (hold_token),
  KEY idx_appointment_holds_tenant_branch_start_exp (tenant_id, branch_id, start_at, expires_at),
  KEY idx_appointment_holds_tenant_barber_start_exp (tenant_id, barber_id, start_at, expires_at),
  CONSTRAINT fk_appointment_holds_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointment_holds_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointment_holds_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_appointment_holds_service
    FOREIGN KEY (service_id) REFERENCES services(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);
