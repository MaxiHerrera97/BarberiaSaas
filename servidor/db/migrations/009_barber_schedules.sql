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

INSERT INTO barber_business_hours (tenant_id, barber_id, day_of_week, is_closed, open1, close1, open2, close2)
SELECT
  b.tenant_id,
  b.id,
  h.day_of_week,
  h.is_closed,
  h.open1,
  h.close1,
  h.open2,
  h.close2
FROM barbers b
INNER JOIN business_hours h
  ON h.tenant_id = b.tenant_id
LEFT JOIN barber_business_hours bh
  ON bh.barber_id = b.id AND bh.day_of_week = h.day_of_week
WHERE bh.id IS NULL;
