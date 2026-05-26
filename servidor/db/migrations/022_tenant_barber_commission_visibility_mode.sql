-- Define cómo ve comisiones el rol barber en su panel:
-- realtime: ve lo ganado del día en tiempo real.
-- next_day: lo de hoy queda oculto y se muestra desde el día siguiente.

ALTER TABLE tenant_settings
  ADD COLUMN barber_commission_visibility_mode
    ENUM('realtime', 'next_day')
    NOT NULL
    DEFAULT 'realtime'
    AFTER hero_slide_3_subtitle;
