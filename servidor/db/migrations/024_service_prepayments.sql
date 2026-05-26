-- Señas por servicio para reservas online.

ALTER TABLE services
  ADD COLUMN booking_prepayment_mode
    ENUM('none', 'total', 'percent', 'fixed')
    NOT NULL
    DEFAULT 'none'
    AFTER quote_only,
  ADD COLUMN booking_prepayment_percent
    TINYINT UNSIGNED NULL
    AFTER booking_prepayment_mode,
  ADD COLUMN booking_prepayment_fixed_ars
    INT UNSIGNED NULL
    AFTER booking_prepayment_percent;

ALTER TABLE appointment_payment_intents
  ADD COLUMN service_total_ars INT UNSIGNED NOT NULL DEFAULT 0 AFTER amount_ars,
  ADD COLUMN remaining_ars INT UNSIGNED NOT NULL DEFAULT 0 AFTER service_total_ars,
  ADD COLUMN prepayment_mode
    ENUM('none', 'total', 'percent', 'fixed')
    NOT NULL
    DEFAULT 'none'
    AFTER remaining_ars,
  ADD COLUMN prepayment_percent_snapshot TINYINT UNSIGNED NULL AFTER prepayment_mode,
  ADD COLUMN prepayment_fixed_ars_snapshot INT UNSIGNED NULL AFTER prepayment_percent_snapshot;

ALTER TABLE appointments
  ADD COLUMN booking_paid_ars_snapshot INT UNSIGNED NOT NULL DEFAULT 0 AFTER barber_commission_ars_snapshot,
  ADD COLUMN booking_due_ars_snapshot INT UNSIGNED NOT NULL DEFAULT 0 AFTER booking_paid_ars_snapshot;
