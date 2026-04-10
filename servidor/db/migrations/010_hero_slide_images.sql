SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_1_image_url'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE tenant_settings ADD COLUMN hero_slide_1_image_url VARCHAR(500) NULL AFTER hero_mode',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_2_image_url'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE tenant_settings ADD COLUMN hero_slide_2_image_url VARCHAR(500) NULL AFTER hero_slide_1_subtitle',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_3_image_url'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE tenant_settings ADD COLUMN hero_slide_3_image_url VARCHAR(500) NULL AFTER hero_slide_2_subtitle',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
