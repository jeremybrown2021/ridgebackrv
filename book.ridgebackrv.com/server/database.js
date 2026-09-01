import mysql from "mysql2/promise";

function databaseOptions(database, overrides = {}) {
  const url = new URL(database.url);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    connectTimeout: 10_000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    ...overrides,
  };
}

export function createDatabasePool(database) {
  return mysql.createPool({
    ...databaseOptions(database),
    waitForConnections: true,
    connectionLimit: database.connectionLimit,
    maxIdle: database.connectionLimit,
    idleTimeout: 60_000,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

export function createMigrationConnection(database) {
  return mysql.createConnection(databaseOptions(database, { multipleStatements: true }));
}

export async function checkDatabase(pool) {
  const [rows] = await pool.execute("SELECT DATABASE() AS database_name, VERSION() AS version");
  return rows[0];
}
