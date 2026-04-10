USE tu_estilo_barberia;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_1_title'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_1_title VARCHAR(120) NULL AFTER hero_mode', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_1_subtitle'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_1_subtitle VARCHAR(255) NULL AFTER hero_slide_1_title', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_2_title'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_2_title VARCHAR(120) NULL AFTER hero_slide_1_subtitle', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_2_subtitle'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_2_subtitle VARCHAR(255) NULL AFTER hero_slide_2_title', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_3_title'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_3_title VARCHAR(120) NULL AFTER hero_slide_2_subtitle', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_settings'
    AND COLUMN_NAME = 'hero_slide_3_subtitle'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_settings ADD COLUMN hero_slide_3_subtitle VARCHAR(255) NULL AFTER hero_slide_3_title', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE tenant_settings
SET
  hero_slide_1_title = COALESCE(NULLIF(TRIM(hero_slide_1_title), ""), brand_name),
  hero_slide_1_subtitle = COALESCE(NULLIF(TRIM(hero_slide_1_subtitle), ""), tagline, "Cortes modernos, clasicos y afeitado premium."),
  hero_slide_2_title = COALESCE(NULLIF(TRIM(hero_slide_2_title), ""), CONCAT("Atencion personalizada en ", brand_name)),
  hero_slide_2_subtitle = COALESCE(NULLIF(TRIM(hero_slide_2_subtitle), ""), "Elegi tu barbero y reserva en minutos."),
  hero_slide_3_title = COALESCE(NULLIF(TRIM(hero_slide_3_title), ""), "Experiencia completa"),
  hero_slide_3_subtitle = COALESCE(NULLIF(TRIM(hero_slide_3_subtitle), ""), "Detalles, estilo y precision en cada turno.")
WHERE tenant_id > 0;
