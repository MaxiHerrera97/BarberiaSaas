-- Permite reutilizar horarios cuando el turno anterior quedó en no_show/cancelled/done.
-- Mantiene unicidad solo para turnos "activos" (pending/in_progress).

SET @db := DATABASE();

-- 1) Eliminar índice viejo si existe (bloqueaba cualquier reapertura de horario)
SET @has_old_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'appointments'
    AND index_name = 'uq_appointment_barber_start'
);
SET @drop_old_idx_sql := IF(
  @has_old_idx > 0,
  'ALTER TABLE appointments DROP INDEX uq_appointment_barber_start',
  'SELECT 1'
);
PREPARE stmt_drop_old_idx FROM @drop_old_idx_sql;
EXECUTE stmt_drop_old_idx;
DEALLOCATE PREPARE stmt_drop_old_idx;

-- 2) Columna generada: solo conserva start_at para estados activos
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS active_start_at DATETIME
  GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('pending', 'in_progress') THEN start_at
      ELSE NULL
    END
  ) STORED;

-- 3) Índice único solo para activos (NULL en otros estados no colisiona)
SET @has_active_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'appointments'
    AND index_name = 'uq_appointments_active_slot'
);
SET @create_active_idx_sql := IF(
  @has_active_idx = 0,
  'CREATE UNIQUE INDEX uq_appointments_active_slot ON appointments (tenant_id, barber_id, active_start_at)',
  'SELECT 1'
);
PREPARE stmt_create_active_idx FROM @create_active_idx_sql;
EXECUTE stmt_create_active_idx;
DEALLOCATE PREPARE stmt_create_active_idx;

