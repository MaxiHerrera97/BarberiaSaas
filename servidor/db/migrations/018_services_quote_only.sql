ALTER TABLE services
  ADD COLUMN quote_only TINYINT(1) NOT NULL DEFAULT 0 AFTER duration_min;

