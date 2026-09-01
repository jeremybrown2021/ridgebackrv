import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "./app.js";
import { CloverClient } from "./clover-client.js";
import { loadConfig } from "./config.js";
import { checkDatabase, createDatabasePool } from "./database.js";
import { MySqlBookingStore } from "./mysql-booking-store.js";
import { MySqlAuthStore } from "./mysql-auth-store.js";
import { createPasswordResetMailer } from "./password-reset-mailer.js";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverDirectory, "..");
const config = loadConfig(projectRoot);
const pool = createDatabasePool(config.database);
const database = await checkDatabase(pool);
const cloverClient = new CloverClient(config.clover);
const ledger = new MySqlBookingStore(pool);
const authStore = new MySqlAuthStore(pool);
const passwordResetMailer = createPasswordResetMailer(config.auth);
const handler = createRequestHandler({ config, cloverClient, ledger, authStore, passwordResetMailer, staticRoot: projectRoot });

const server = createServer(handler);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, () => {
  console.log(`Ridgeback booking server listening on ${config.appOrigin}`);
  console.log(`MySQL database: ${database.database_name} (${database.version})`);
  console.log(`Clover payments: ${config.paymentsEnabled ? `enabled (${config.clover.environment})` : "disabled"}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing server.`);
  server.close(async (error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
    await pool.end();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
