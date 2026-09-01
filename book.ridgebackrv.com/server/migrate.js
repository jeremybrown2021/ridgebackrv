import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createMigrationConnection } from "./database.js";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDirectory, "..");
const migrationsDirectory = resolve(projectRoot, "database/migrations");
const config = loadConfig(projectRoot);
const connection = await createMigrationConnection(config.database);
const mysql8Collation = "utf8mb4_0900_ai_ci";
const compatibleCollation = "utf8mb4_unicode_ci";
const authMigrationVersion = "004_auth_system.sql";

const authMigrationColumns = {
  users: [
    "id", "email", "full_name", "password_hash", "phone", "rv_details", "is_active",
    "password_changed_at", "last_login_at", "created_at", "updated_at",
  ],
  auth_sessions: [
    "id", "user_id", "token_hash", "is_persistent", "expires_at", "last_seen_at",
    "created_ip", "user_agent", "created_at",
  ],
  password_reset_tokens: [
    "id", "user_id", "token_hash", "expires_at", "consumed_at", "requested_ip", "created_at",
  ],
  reservations: ["user_id"],
};

async function inspectExistingAuthSchema(databaseConnection) {
  const tableNames = Object.keys(authMigrationColumns);
  const placeholders = tableNames.map(() => "?").join(", ");
  const [columnRows] = await databaseConnection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames,
  );
  const presentColumns = new Set(
    columnRows.map((row) => `${String(row.TABLE_NAME || row.table_name)}.${String(row.COLUMN_NAME || row.column_name)}`),
  );

  const [indexRows] = await databaseConnection.execute(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'reservations'
       AND INDEX_NAME = 'idx_reservations_user_created'`,
  );
  const [constraintRows] = await databaseConnection.execute(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'reservations'
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       AND CONSTRAINT_NAME = 'fk_reservations_user'`,
  );

  const required = Object.entries(authMigrationColumns).flatMap(([table, columns]) => (
    columns.map((column) => `${table}.${column}`)
  ));
  const present = required.filter((item) => presentColumns.has(item));
  if (indexRows.length) present.push("reservations.idx_reservations_user_created");
  if (constraintRows.length) present.push("reservations.fk_reservations_user");

  const allRequired = [
    ...required,
    "reservations.idx_reservations_user_created",
    "reservations.fk_reservations_user",
  ];
  return {
    complete: present.length === allRequired.length,
    untouched: present.length === 0,
    missing: allRequired.filter((item) => !present.includes(item)),
  };
}

try {
  const [collationRows] = await connection.execute(
    `SELECT COUNT(*) AS supported
     FROM information_schema.COLLATIONS
     WHERE COLLATION_NAME = ?`,
    [mysql8Collation],
  );
  const selectedCollation = Number(collationRows[0]?.supported || 0) > 0
    ? mysql8Collation
    : compatibleCollation;

  console.log(`Migration collation: ${selectedCollation}`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${selectedCollation}
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const version of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory, version), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [rows] = await connection.execute(
      "SELECT checksum FROM schema_migrations WHERE version = ?",
      [version],
    );

    if (rows.length) {
      if (rows[0].checksum !== checksum) {
        throw new Error(`Migration ${version} was modified after it was applied.`);
      }
      console.log(`Already applied: ${version}`);
      continue;
    }

    if (version === authMigrationVersion) {
      const authSchema = await inspectExistingAuthSchema(connection);
      if (authSchema.complete) {
        await connection.execute(
          "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
          [version, checksum],
        );
        console.log(`Recorded existing schema: ${version}`);
        continue;
      }
      if (!authSchema.untouched) {
        throw new Error(
          `Migration ${version} is partially applied. Missing: ${authSchema.missing.join(", ")}`,
        );
      }
    }

    const executableSql = selectedCollation === mysql8Collation
      ? sql
      : sql.replaceAll(mysql8Collation, selectedCollation);
    await connection.query(executableSql);
    await connection.execute(
      "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
      [version, checksum],
    );
    console.log(`Applied: ${version}`);
  }
} finally {
  await connection.end();
}
