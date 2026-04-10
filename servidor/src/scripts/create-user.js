require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("../db");

async function main() {
  const [tenantSlugArg, username, fullName, role, barberIdStr, password] = process.argv.slice(2);
  const tenantSlug = String(tenantSlugArg || process.env.DEFAULT_TENANT_SLUG || "tu-estilo-default");

  if (!tenantSlug || !username || !fullName || !role || !password) {
    console.log(
      'Uso:\nnode src/scripts/create-user.js <tenant-slug> <username> "<full name>" <admin|barber> <barberId|none> <password>\n'
    );
    process.exit(1);
  }

  const barberId = barberIdStr && barberIdStr !== "none" ? Number(barberIdStr) : null;
  const [tenantRows] = await pool.query(
    `SELECT id FROM tenants WHERE slug = :slug LIMIT 1`,
    { slug: tenantSlug }
  );
  if (!tenantRows.length) {
    console.error(`Tenant no existe: ${tenantSlug}`);
    process.exit(1);
  }
  const tenantId = tenantRows[0].id;

  const hash = await bcrypt.hash(password, 10);

  let branchId = null;
  if (role === "barber" && barberId) {
    const [barberRows] = await pool.query(
      `SELECT branch_id
       FROM barbers
       WHERE id = :barberId AND tenant_id = :tenantId
       LIMIT 1`,
      { barberId, tenantId }
    );
    if (!barberRows.length) {
      console.error(`Barbero no existe en tenant: ${barberId}`);
      process.exit(1);
    }
    branchId = barberRows[0].branch_id || null;
  }

  await pool.query(
    `INSERT INTO users (tenant_id, branch_id, full_name, username, password_hash, role, barber_id)
     VALUES (:tenantId, :branchId, :fullName, :username, :hash, :role, :barberId)`,
    { tenantId, branchId, fullName, username, hash, role, barberId }
  );

  console.log("Usuario creado:", username);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
