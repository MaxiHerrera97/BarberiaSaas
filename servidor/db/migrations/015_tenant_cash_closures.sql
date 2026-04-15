-- Fase 3: cierre diario de caja

CREATE TABLE IF NOT EXISTS tenant_cash_closures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  branch_scope_id INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=todas las sucursales, >0 sucursal específica',
  branch_id INT UNSIGNED NULL,
  closure_date DATE NOT NULL,
  services_done INT UNSIGNED NOT NULL DEFAULT 0,
  revenue_ars INT UNSIGNED NOT NULL DEFAULT 0,
  commission_ars INT UNSIGNED NOT NULL DEFAULT 0,
  by_barber_json JSON NULL,
  by_service_json JSON NULL,
  closed_by_user_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_cash_closure_scope_day (tenant_id, branch_scope_id, closure_date),
  KEY idx_tenant_cash_closure_day (tenant_id, closure_date),
  KEY idx_tenant_cash_closure_branch (tenant_id, branch_id),
  CONSTRAINT fk_tenant_cash_closure_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_tenant_cash_closure_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_tenant_cash_closure_user
    FOREIGN KEY (closed_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

