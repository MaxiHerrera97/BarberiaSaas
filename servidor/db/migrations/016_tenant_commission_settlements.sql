-- Fase 3: liquidación de comisiones por barbero y mes

CREATE TABLE IF NOT EXISTS tenant_commission_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_scope_id INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=todas las sucursales, >0 sucursal específica',
  branch_id INT UNSIGNED NULL,
  barber_id INT UNSIGNED NOT NULL,
  settlement_month CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  amount_ars INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending', 'settled') NOT NULL DEFAULT 'pending',
  settled_at DATETIME NULL,
  paid_by_user_id INT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_commission_settlement_scope (tenant_id, branch_scope_id, barber_id, settlement_month),
  KEY idx_tenant_commission_settlement_month (tenant_id, settlement_month),
  CONSTRAINT fk_tenant_commission_settlement_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_tenant_commission_settlement_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_tenant_commission_settlement_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_tenant_commission_settlement_user
    FOREIGN KEY (paid_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

