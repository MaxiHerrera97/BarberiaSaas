USE tu_estilo;

ALTER TABLE barbers
  ADD COLUMN commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER full_name;

ALTER TABLE appointments
  ADD COLUMN barber_commission_pct_snapshot DECIMAL(5,2) NULL AFTER service_duration_min_snapshot,
  ADD COLUMN barber_commission_ars_snapshot INT UNSIGNED NULL AFTER barber_commission_pct_snapshot;
