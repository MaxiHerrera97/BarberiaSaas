-- Colores personalizables por barbería para la landing pública.

ALTER TABLE tenant_settings
  ADD COLUMN theme_bg_main CHAR(7) NOT NULL DEFAULT '#090A0D' AFTER barber_commission_visibility_mode,
  ADD COLUMN theme_bg_elevated CHAR(7) NOT NULL DEFAULT '#12141A' AFTER theme_bg_main,
  ADD COLUMN theme_bg_soft CHAR(7) NOT NULL DEFAULT '#171A21' AFTER theme_bg_elevated,
  ADD COLUMN theme_text_main CHAR(7) NOT NULL DEFAULT '#F6F5F1' AFTER theme_bg_soft,
  ADD COLUMN theme_text_muted CHAR(7) NOT NULL DEFAULT '#B7B8BE' AFTER theme_text_main,
  ADD COLUMN theme_brand CHAR(7) NOT NULL DEFAULT '#D9A13D' AFTER theme_text_muted,
  ADD COLUMN theme_brand_soft CHAR(7) NOT NULL DEFAULT '#F2C879' AFTER theme_brand,
  ADD COLUMN theme_brand_deep CHAR(7) NOT NULL DEFAULT '#9D6F1D' AFTER theme_brand_soft;
