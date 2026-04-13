USE tu_estilo;

ALTER TABLE appointments
  ADD COLUMN service_name_snapshot VARCHAR(120) NULL AFTER service_id,
  ADD COLUMN service_price_ars_snapshot INT UNSIGNED NULL AFTER service_name_snapshot,
  ADD COLUMN service_duration_min_snapshot INT UNSIGNED NULL AFTER service_price_ars_snapshot;
