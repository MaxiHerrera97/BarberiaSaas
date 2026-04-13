USE tu_estilo;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_active TINYINT(1) NOT NULL DEFAULT 0 AFTER timezone,
  ADD COLUMN IF NOT EXISTS trial_starts_at DATETIME NULL AFTER trial_active,
  ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME NULL AFTER trial_starts_at;
