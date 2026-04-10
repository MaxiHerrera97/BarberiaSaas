
require("dotenv").config();
const mysql = require("mysql2/promise");
const { getDbConfig } = require("./config");

const dbConfig = getDbConfig();

const pool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  ssl: dbConfig.ssl || undefined,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,

  // ✅ clave: NO convertir a UTC
  timezone: "local",

  // ✅ clave: devolver DATETIME como string para que el front lo parsee "local"
  dateStrings: ["DATETIME", "TIMESTAMP", "DATE"],
});

module.exports = { pool };
