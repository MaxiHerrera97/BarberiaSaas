USE tu_estilo_barberia;

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_username VARCHAR(80) NOT NULL,
  action VARCHAR(80) NOT NULL,
  tenant_id INT UNSIGNED NULL,
  target_user_id INT UNSIGNED NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_platform_audit_created_at (created_at),
  KEY idx_platform_audit_tenant (tenant_id),
  CONSTRAINT fk_platform_audit_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_platform_audit_user
    FOREIGN KEY (target_user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
