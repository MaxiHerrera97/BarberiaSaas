-- Agrega tercera ventana horaria para tenant y barberos

ALTER TABLE business_hours
  ADD COLUMN open3 TIME NULL AFTER close2,
  ADD COLUMN close3 TIME NULL AFTER open3;

ALTER TABLE barber_business_hours
  ADD COLUMN open3 TIME NULL AFTER close2,
  ADD COLUMN close3 TIME NULL AFTER open3;

ALTER TABLE barber_schedule_exceptions
  ADD COLUMN open3 TIME NULL AFTER close2,
  ADD COLUMN close3 TIME NULL AFTER open3;

