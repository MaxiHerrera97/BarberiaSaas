USE tu_estilo_barberia;

CREATE TABLE IF NOT EXISTS tenants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  plan ENUM('free', 'basic', 'pro') NOT NULL DEFAULT 'free',
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug)
);

INSERT INTO tenants (slug, name, plan, status, timezone)
VALUES ('tu-estilo-default', 'Tu Estilo - Barberia', 'free', 'active', 'America/Argentina/Buenos_Aires')
ON DUPLICATE KEY UPDATE
  name = VALUES(name);

SET @default_tenant_id = (SELECT id FROM tenants WHERE slug = 'tu-estilo-default' LIMIT 1);

ALTER TABLE barbers ADD COLUMN tenant_id INT UNSIGNED NULL;
UPDATE barbers SET tenant_id = @default_tenant_id WHERE tenant_id IS NULL;
ALTER TABLE barbers MODIFY tenant_id INT UNSIGNED NOT NULL;
ALTER TABLE barbers ADD KEY idx_barbers_tenant (tenant_id);
ALTER TABLE barbers
  ADD CONSTRAINT fk_barbers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE services ADD COLUMN tenant_id INT UNSIGNED NULL;
UPDATE services SET tenant_id = @default_tenant_id WHERE tenant_id IS NULL;
ALTER TABLE services MODIFY tenant_id INT UNSIGNED NOT NULL;
ALTER TABLE services ADD KEY idx_services_tenant (tenant_id);
ALTER TABLE services
  ADD CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE users ADD COLUMN tenant_id INT UNSIGNED NULL;
UPDATE users SET tenant_id = @default_tenant_id WHERE tenant_id IS NULL;
ALTER TABLE users MODIFY tenant_id INT UNSIGNED NOT NULL;
ALTER TABLE users DROP INDEX uq_users_username;
ALTER TABLE users ADD UNIQUE KEY uq_users_tenant_username (tenant_id, username);
ALTER TABLE users ADD KEY idx_users_tenant (tenant_id);
ALTER TABLE users
  ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE appointments ADD COLUMN tenant_id INT UNSIGNED NULL;
UPDATE appointments SET tenant_id = @default_tenant_id WHERE tenant_id IS NULL;
ALTER TABLE appointments MODIFY tenant_id INT UNSIGNED NOT NULL;
ALTER TABLE appointments DROP INDEX idx_appointments_barber_start;
ALTER TABLE appointments DROP INDEX idx_appointments_status_start;
ALTER TABLE appointments ADD KEY idx_appointments_tenant_barber_start (tenant_id, barber_id, start_at);
ALTER TABLE appointments ADD KEY idx_appointments_tenant_status_start (tenant_id, status, start_at);
ALTER TABLE appointments
  ADD CONSTRAINT fk_appointments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE appointment_holds ADD COLUMN tenant_id INT UNSIGNED NULL;
UPDATE appointment_holds SET tenant_id = @default_tenant_id WHERE tenant_id IS NULL;
ALTER TABLE appointment_holds MODIFY tenant_id INT UNSIGNED NOT NULL;
ALTER TABLE appointment_holds DROP INDEX idx_appointment_holds_barber_start_exp;
ALTER TABLE appointment_holds ADD KEY idx_appointment_holds_tenant_barber_start_exp (tenant_id, barber_id, start_at, expires_at);
ALTER TABLE appointment_holds
  ADD CONSTRAINT fk_appointment_holds_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
