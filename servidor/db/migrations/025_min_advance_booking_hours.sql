-- Anticipación mínima para reservar turno (en horas enteras; 0 = sin restricción)
ALTER TABLE tenant_settings
  ADD COLUMN min_advance_booking_hours TINYINT UNSIGNED NOT NULL DEFAULT 0;
