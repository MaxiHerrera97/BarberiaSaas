USE tu_estilo_barberia;

CREATE TABLE IF NOT EXISTS tenant_billing_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  billing_month CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  amount_ars INT UNSIGNED NOT NULL DEFAULT 30000,
  payment_method ENUM('transferencia', 'mercado_pago', 'efectivo') NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(255) NULL,
  recorded_by VARCHAR(80) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_billing_month (tenant_id, billing_month),
  KEY idx_tenant_billing_paid_at (tenant_id, paid_at),
  CONSTRAINT fk_tenant_billing_payments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
