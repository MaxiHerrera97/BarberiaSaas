USE tu_estilo_barberia;

SET @has_logo_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'logo_url'
);

SET @sql := IF(
  @has_logo_col = 0,
  'ALTER TABLE tenant_settings ADD COLUMN logo_url VARCHAR(500) NULL AFTER address',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
