USE tu_estilo_barberia;

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

INSERT INTO branches (tenant_id, name, slug, is_active)
SELECT t.id, 'Sucursal Principal', 'principal', 1
FROM tenants t
LEFT JOIN branches b ON b.tenant_id = t.id AND b.slug = 'principal'
WHERE b.id IS NULL;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'barbers' AND COLUMN_NAME = 'branch_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE barbers ADD COLUMN branch_id INT UNSIGNED NULL AFTER tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE barbers b
INNER JOIN branches br ON br.tenant_id = b.tenant_id AND br.slug = 'principal'
SET b.branch_id = br.id
WHERE b.branch_id IS NULL;

ALTER TABLE barbers MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
CREATE INDEX idx_barbers_branch ON barbers(branch_id);

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'barbers'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_barbers_branch'
);
SET @sql := IF(@has_fk = 0, 'ALTER TABLE barbers ADD CONSTRAINT fk_barbers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'branch_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE users ADD COLUMN branch_id INT UNSIGNED NULL AFTER tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE users u
LEFT JOIN barbers b ON b.id = u.barber_id
SET u.branch_id = b.branch_id
WHERE u.branch_id IS NULL;

CREATE INDEX idx_users_branch_id ON users(branch_id);

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_users_branch'
);
SET @sql := IF(@has_fk = 0, 'ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'branch_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE appointments ADD COLUMN branch_id INT UNSIGNED NULL AFTER tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE appointments a
LEFT JOIN barbers b ON b.id = a.barber_id
SET a.branch_id = b.branch_id
WHERE a.branch_id IS NULL;

ALTER TABLE appointments MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
CREATE INDEX idx_appointments_tenant_branch_start ON appointments(tenant_id, branch_id, start_at);

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'appointments'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_appointments_branch'
);
SET @sql := IF(@has_fk = 0, 'ALTER TABLE appointments ADD CONSTRAINT fk_appointments_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_holds' AND COLUMN_NAME = 'branch_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE appointment_holds ADD COLUMN branch_id INT UNSIGNED NULL AFTER tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE appointment_holds h
LEFT JOIN barbers b ON b.id = h.barber_id
SET h.branch_id = b.branch_id
WHERE h.branch_id IS NULL;

ALTER TABLE appointment_holds MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
CREATE INDEX idx_appointment_holds_tenant_branch_start_exp ON appointment_holds(tenant_id, branch_id, start_at, expires_at);

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'appointment_holds'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_appointment_holds_branch'
);
SET @sql := IF(@has_fk = 0, 'ALTER TABLE appointment_holds ADD CONSTRAINT fk_appointment_holds_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
