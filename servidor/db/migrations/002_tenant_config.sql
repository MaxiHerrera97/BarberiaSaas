USE tu_estilo_barberia;

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INT UNSIGNED NOT NULL,
  brand_name VARCHAR(120) NOT NULL,
  tagline VARCHAR(255) NULL,
  contact_phone VARCHAR(25) NULL,
  contact_whatsapp VARCHAR(25) NULL,
  contact_instagram VARCHAR(80) NULL,
  address VARCHAR(255) NULL,
  hero_mode ENUM('generic', 'custom') NOT NULL DEFAULT 'generic',
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

INSERT INTO tenant_settings (tenant_id, brand_name)
SELECT t.id, t.name
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
