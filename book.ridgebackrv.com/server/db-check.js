import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { checkDatabase, createDatabasePool } from "./database.js";
import { MySqlBookingStore } from "./mysql-booking-store.js";
import { normalizeBooking } from "./pricing.js";

const requiredTables = [
  "auth_sessions",
  "daily_rates",
  "extras",
  "payment_attempts",
  "password_reset_tokens",
  "quotes",
  "reservations",
  "reservation_extras",
  "reservation_sites",
  "site_inventory_days",
  "sites",
  "site_types",
  "users",
  "webhook_events",
];

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDirectory, "..");
const config = loadConfig(projectRoot);
const pool = createDatabasePool(config.database);

try {
  const database = await checkDatabase(pool);
  const [tableRows] = await pool.execute(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
     ORDER BY table_name`,
  );
  const present = new Set(tableRows.map((row) => row.TABLE_NAME || row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Missing required tables: ${missing.join(", ")}`);

  const [catalogRows] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM site_types WHERE is_active = 1) AS site_types,
       (SELECT COUNT(*) FROM sites WHERE is_active = 1) AS sites,
       (SELECT COUNT(*) FROM extras WHERE is_active = 1) AS extras`,
  );
  const arrival = new Date();
  arrival.setUTCDate(arrival.getUTCDate() + 7);
  const booking = normalizeBooking({
    arrival: arrival.toISOString().slice(0, 10),
    nights: 2,
    sites: 1,
    adults: 2,
    children: 0,
    siteType: "standard",
    extras: ["vehicle"],
  });
  const store = new MySqlBookingStore(pool);
  const pricing = await store.calculatePrice(booking);
  const [planRows] = await pool.execute(
    `EXPLAIN SELECT s.id
     FROM sites AS s
     WHERE s.site_type_id = (SELECT id FROM site_types WHERE code = 'standard')
       AND s.is_active = 1
       AND NOT EXISTS (
         SELECT 1 FROM site_inventory_days AS sid
         WHERE sid.site_id = s.id
           AND sid.stay_date >= ?
           AND sid.stay_date < DATE_ADD(?, INTERVAL ? DAY)
           AND sid.status_code <> 'available'
       )
     ORDER BY s.id
     LIMIT 1`,
    [booking.arrival, booking.arrival, booking.nights],
  );
  const [authIndexRows] = await pool.execute(
    `SELECT index_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name IN ('users', 'auth_sessions', 'password_reset_tokens')
     ORDER BY table_name, index_name, seq_in_index`,
  );

  console.log(JSON.stringify({
    connected: true,
    database: database.database_name,
    version: database.version,
    requiredTables: requiredTables.length,
    catalog: catalogRows[0],
    sampleTotalCents: pricing.totalCents,
    availabilityIndexes: [...new Set(planRows.map((row) => row.key).filter(Boolean))],
    authIndexes: [...new Set(authIndexRows.map((row) => row.index_name || row.INDEX_NAME).filter(Boolean))],
  }, null, 2));
} finally {
  await pool.end();
}
