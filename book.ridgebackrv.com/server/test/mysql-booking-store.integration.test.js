import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createDatabasePool } from "../database.js";
import { MySqlBookingStore } from "../mysql-booking-store.js";
import { normalizeBooking } from "../pricing.js";

const runIntegration = process.env.RUN_MYSQL_INTEGRATION === "true";

test("persists a quote, reserves inventory, and releases it after a decline", { skip: !runIntegration }, async () => {
  const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const projectRoot = resolve(serverDirectory, "..");
  const config = loadConfig(projectRoot);
  const pool = createDatabasePool(config.database);

  try {
    const store = new MySqlBookingStore(pool);
    const arrival = new Date();
    arrival.setUTCDate(arrival.getUTCDate() + 300);
    const booking = normalizeBooking({
      arrival: arrival.toISOString().slice(0, 10),
      nights: 2,
      sites: 1,
      adults: 1,
      children: 2,
      childAges: [4, 7],
      siteType: "standard",
      extras: ["vehicle"],
    });
    const pricing = await store.calculatePrice(booking);
    const now = Math.floor(Date.now() / 1000);
    const quote = {
      version: 1,
      quoteId: randomBytes(12).toString("hex"),
      booking,
      pricing,
      issuedAt: now,
      expiresAt: now + 900,
    };
    await store.createQuote(quote);
    const idempotencyKey = randomUUID();
    const reservation = await store.reserve(quote.quoteId, idempotencyKey, {
      quote,
      clientIp: "127.0.0.1",
      guest: {
        fullName: "Local Database Integration Test",
        email: "mysql-integration@ridgeback.invalid",
        phone: "+1 713 555 0100",
      },
    });
    assert.equal(reservation.state, "new");

    await store.fail(quote.quoteId, idempotencyKey, {
      status: 402,
      body: { error: "card_declined", message: "Intentional local integration test decline." },
    });
    const repeated = await store.reserve(quote.quoteId, idempotencyKey, {
      quote,
      clientIp: "127.0.0.1",
      guest: {
        fullName: "Local Database Integration Test",
        email: "mysql-integration@ridgeback.invalid",
        phone: "+1 713 555 0100",
      },
    });
    assert.equal(repeated.state, "failed");
    await assert.rejects(
      store.complete(quote.quoteId, idempotencyKey, {
        paymentId: `TEST-${quote.quoteId}`,
        reference: "TEST-LATE-SUCCESS",
        amountCents: pricing.totalCents,
        currency: "usd",
        paid: true,
        captured: true,
      }),
      /failed payment attempt cannot be changed to succeeded/i,
    );

    const [rows] = await pool.execute(
      `SELECT r.status_code,
              SUM(sid.status_code = 'available' AND sid.reservation_id IS NULL) AS released_nights
       FROM reservations AS r
       JOIN quotes AS q ON q.id = r.quote_id
       LEFT JOIN reservation_sites AS rs ON rs.reservation_id = r.id
       LEFT JOIN site_inventory_days AS sid ON sid.site_id = rs.site_id
         AND sid.stay_date >= r.arrival_date AND sid.stay_date < r.departure_date
       WHERE q.quote_key = ?
       GROUP BY r.id, r.status_code`,
      [quote.quoteId],
    );
    assert.equal(rows[0].status_code, "payment_failed");
    assert.equal(Number(rows[0].released_nights), booking.nights);

    const [quoteRows] = await pool.execute(
      "SELECT booking_snapshot FROM quotes WHERE quote_key = ?",
      [quote.quoteId],
    );
    const bookingSnapshot = typeof quoteRows[0].booking_snapshot === "string"
      ? JSON.parse(quoteRows[0].booking_snapshot)
      : quoteRows[0].booking_snapshot;
    assert.deepEqual(bookingSnapshot.childAges, [4, 7]);
  } finally {
    await pool.end();
  }
});
