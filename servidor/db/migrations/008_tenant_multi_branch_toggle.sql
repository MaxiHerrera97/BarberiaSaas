SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenants'
    AND COLUMN_NAME = 'multi_branch_enabled'
);

SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE tenants ADD COLUMN multi_branch_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER timezone',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE tenants
SET multi_branch_enabled = 1
WHERE id > 0
  AND EXISTS (
    SELECT 1
    FROM branches b
    WHERE b.tenant_id = tenants.id AND b.is_active = 1
    GROUP BY b.tenant_id
    HAVING COUNT(*) > 1
  );
