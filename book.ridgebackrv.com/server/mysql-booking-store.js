import { isDeepStrictEqual } from "node:util";
import { PaymentConflictError } from "./payment-ledger.js";
import { TAX_BASIS_POINTS, ValidationError } from "./pricing.js";

const HOLD_MINUTES = 30;
const TERMS_VERSION = "2026-08-24";

export class AvailabilityError extends Error {
  constructor(message = "The requested site inventory is no longer available.") {
    super(message);
    this.name = "AvailabilityError";
  }
}

function asNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Database returned an unsafe integer value.");
  return number;
}

function asJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function isoDateAfter(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stayDates(arrival, nights) {
  return Array.from({ length: nights }, (_, index) => isoDateAfter(arrival, index));
}

function mysqlDateTimeFromUnix(seconds) {
  return new Date(seconds * 1000);
}

function utcMillis(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  return new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`).getTime();
}

function reservationNumber(quoteId) {
  return `RB-${quoteId.toUpperCase()}`;
}

async function rollbackQuietly(connection) {
  try {
    await connection.rollback();
  } catch {
    // Preserve the original transaction error.
  }
}

async function withDeadlockRetry(operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (Number(error.errno) !== 1213 || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (2 ** attempt)));
    }
  }
}

function storedPaymentState(row) {
  if (row.status_code === "succeeded") {
    return { state: "succeeded", record: { result: asJson(row.result_snapshot) } };
  }
  if (row.status_code === "declined" || row.status_code === "failed") {
    return { state: "failed", record: { result: asJson(row.result_snapshot) } };
  }
  return { state: "started", record: { status: row.status_code } };
}

export class MySqlBookingStore {
  constructor(pool) {
    this.pool = pool;
  }

  async healthCheck() {
    const [rows] = await this.pool.execute("SELECT DATABASE() AS database_name");
    return { connected: true, database: rows[0].database_name };
  }

  async calculatePrice(booking) {
    const [siteTypes] = await this.pool.execute(
      `SELECT id, name, default_nightly_cents
       FROM site_types
       WHERE code = ? AND is_active = 1`,
      [booking.siteType],
    );
    if (siteTypes.length !== 1) {
      throw new ValidationError("Select a valid site type.", { siteType: "This site type is not currently available." });
    }

    const siteType = siteTypes[0];
    const departure = isoDateAfter(booking.arrival, booking.nights);
    const [dailyRates] = await this.pool.execute(
      `SELECT dr.stay_date, dr.nightly_cents
       FROM daily_rates AS dr
       JOIN rate_plans AS rp ON rp.id = dr.rate_plan_id
       WHERE dr.site_type_id = ?
         AND rp.code = 'public'
         AND rp.is_active = 1
         AND dr.stay_date >= ?
         AND dr.stay_date < ?
       ORDER BY dr.stay_date`,
      [siteType.id, booking.arrival, departure],
    );
    const rateByDate = new Map(dailyRates.map((row) => [String(row.stay_date).slice(0, 10), asNumber(row.nightly_cents)]));
    const defaultNightlyCents = asNumber(siteType.default_nightly_cents);
    const nightlyTotal = stayDates(booking.arrival, booking.nights)
      .reduce((total, date) => total + (rateByDate.get(date) ?? defaultNightlyCents), 0);
    const baseCents = nightlyTotal * booking.sites;

    let extras = [];
    if (booking.extras.length) {
      const placeholders = booking.extras.map(() => "?").join(", ");
      const [rows] = await this.pool.execute(
        `SELECT id, code, name, pricing_unit_code, unit_amount_cents
         FROM extras
         WHERE is_active = 1 AND code IN (${placeholders})
         ORDER BY id`,
        booking.extras,
      );
      if (rows.length !== booking.extras.length) {
        throw new ValidationError("One or more add-ons are unavailable.", { extras: "Refresh the page and choose available add-ons." });
      }
      extras = rows;
    }

    const extraLines = extras.map((extra) => {
      const billableUnits = extra.pricing_unit_code === "per_night" ? booking.nights : 1;
      const unitAmountCents = asNumber(extra.unit_amount_cents);
      return {
        code: extra.code,
        label: extra.name,
        pricingUnit: extra.pricing_unit_code,
        billableUnits,
        unitAmountCents,
        totalCents: unitAmountCents * billableUnits,
      };
    });
    const addOnCents = extraLines.reduce((total, extra) => total + extra.totalCents, 0);
    const subtotalCents = baseCents + addOnCents;
    const taxCents = Math.round((subtotalCents * TAX_BASIS_POINTS) / 10_000);

    return {
      currency: "usd",
      siteLabel: siteType.name,
      baseCents,
      addOnCents,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      extraLines,
    };
  }

  async createQuote(quote) {
    const departure = isoDateAfter(quote.booking.arrival, quote.booking.nights);
    const [siteTypes] = await this.pool.execute(
      "SELECT id FROM site_types WHERE code = ? AND is_active = 1",
      [quote.booking.siteType],
    );
    if (siteTypes.length !== 1) throw new ValidationError("The selected site type is unavailable.");

    await this.pool.execute(
      `INSERT INTO quotes (
         quote_key, status_code, site_type_id, arrival_date, departure_date, nights,
         site_count, adult_count, child_count, booking_snapshot, pricing_snapshot,
         base_amount_cents, extras_amount_cents, subtotal_amount_cents, tax_amount_cents,
         total_amount_cents, currency, issued_at, expires_at
       ) VALUES (?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quote.quoteId,
        siteTypes[0].id,
        quote.booking.arrival,
        departure,
        quote.booking.nights,
        quote.booking.sites,
        quote.booking.adults,
        quote.booking.children,
        JSON.stringify(quote.booking),
        JSON.stringify(quote.pricing),
        quote.pricing.baseCents,
        quote.pricing.addOnCents,
        quote.pricing.subtotalCents,
        quote.pricing.taxCents,
        quote.pricing.totalCents,
        quote.pricing.currency,
        mysqlDateTimeFromUnix(quote.issuedAt),
        mysqlDateTimeFromUnix(quote.expiresAt),
      ],
    );
  }

  async verifyQuote(quote) {
    const [rows] = await this.pool.execute(
      `SELECT status_code, booking_snapshot, pricing_snapshot, expires_at
       FROM quotes WHERE quote_key = ?`,
      [quote.quoteId],
    );
    if (
      rows.length !== 1
      || !["issued", "consumed"].includes(rows[0].status_code)
      || utcMillis(rows[0].expires_at) < Date.now()
      || !isDeepStrictEqual(asJson(rows[0].booking_snapshot), quote.booking)
      || !isDeepStrictEqual(asJson(rows[0].pricing_snapshot), quote.pricing)
    ) {
      throw new Error("Invalid quote token.");
    }
  }

  async reserve(quoteId, idempotencyKey, context) {
    return withDeadlockRetry(() => this.reserveOnce(quoteId, idempotencyKey, context));
  }

  async reserveOnce(quoteId, idempotencyKey, { quote, guest, clientIp, userId = null }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [quotes] = await connection.execute(
        `SELECT q.*, st.code AS site_type_code
         FROM quotes AS q
         JOIN site_types AS st ON st.id = q.site_type_id
         WHERE q.quote_key = ?
         FOR UPDATE`,
        [quoteId],
      );
      if (quotes.length !== 1 || utcMillis(quotes[0].expires_at) < Date.now()) {
        throw new Error("This price quote has expired. Please try again.");
      }
      const quoteRow = quotes[0];

      const [attempts] = await connection.execute(
        `SELECT pa.idempotency_key, pa.status_code, pa.result_snapshot
         FROM payment_attempts AS pa
         WHERE pa.quote_id = ?
         FOR UPDATE`,
        [quoteRow.id],
      );
      if (attempts.length) {
        if (attempts[0].idempotency_key !== idempotencyKey) {
          throw new PaymentConflictError("This quote has already been used for another payment attempt.");
        }
        await connection.commit();
        return storedPaymentState(attempts[0]);
      }
      if (quoteRow.status_code !== "issued") {
        throw new PaymentConflictError("This quote has already been consumed.");
      }

      const limit = asNumber(quoteRow.site_count);
      const [availableSites] = await connection.execute(
        `SELECT s.id
         FROM sites AS s
         WHERE s.site_type_id = ?
           AND s.is_active = 1
           AND NOT EXISTS (
             SELECT 1
             FROM site_inventory_days AS sid
             WHERE sid.site_id = s.id
               AND sid.stay_date >= ?
               AND sid.stay_date < ?
               AND sid.status_code <> 'available'
           )
         ORDER BY s.id
         LIMIT ${limit}
         FOR UPDATE`,
        [quoteRow.site_type_id, quoteRow.arrival_date, quoteRow.departure_date],
      );
      if (availableSites.length !== limit) throw new AvailabilityError();

      const [reservationResult] = await connection.execute(
        `INSERT INTO reservations (
           reservation_number, quote_id, user_id, status_code, site_type_id, arrival_date, departure_date,
           nights, site_count, adult_count, child_count, guest_full_name, guest_email, guest_phone,
           base_amount_cents, extras_amount_cents, discount_amount_cents,
           subtotal_amount_cents, tax_amount_cents, total_amount_cents, currency,
           terms_version, terms_accepted_at, terms_accepted_ip, hold_expires_at
         ) VALUES (
           ?, ?, ?, 'pending_payment', ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, 0,
           ?, ?, ?, ?,
           ?, UTC_TIMESTAMP(6), INET6_ATON(?), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${HOLD_MINUTES} MINUTE)
         )`,
        [
          reservationNumber(quoteId), quoteRow.id, userId, quoteRow.site_type_id,
          quoteRow.arrival_date, quoteRow.departure_date, quoteRow.nights, quoteRow.site_count,
          quoteRow.adult_count, quoteRow.child_count, guest.fullName, guest.email, guest.phone,
          quoteRow.base_amount_cents, quoteRow.extras_amount_cents, quoteRow.subtotal_amount_cents,
          quoteRow.tax_amount_cents, quoteRow.total_amount_cents, quoteRow.currency, TERMS_VERSION, clientIp,
        ],
      );
      const reservationId = reservationResult.insertId;

      const reservationSiteValues = availableSites.flatMap((site) => [reservationId, site.id]);
      const reservationSitePlaceholders = availableSites.map(() => "(?, ?)").join(", ");
      await connection.execute(
        `INSERT INTO reservation_sites (reservation_id, site_id) VALUES ${reservationSitePlaceholders}`,
        reservationSiteValues,
      );

      const dates = stayDates(String(quoteRow.arrival_date).slice(0, 10), asNumber(quoteRow.nights));
      const inventoryRows = availableSites.flatMap((site) => dates.map((date) => [site.id, date, reservationId]));
      for (let offset = 0; offset < inventoryRows.length; offset += 500) {
        const chunk = inventoryRows.slice(offset, offset + 500);
        const placeholders = chunk.map(() => "(?, ?, 'held', ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE))").join(", ");
        await connection.execute(
          `INSERT INTO site_inventory_days (site_id, stay_date, status_code, reservation_id, hold_expires_at)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE
             status_code = VALUES(status_code),
             reservation_id = VALUES(reservation_id),
             hold_expires_at = VALUES(hold_expires_at)`,
          chunk.flat(),
        );
      }

      if (quote.booking.extras.length) {
        const placeholders = quote.booking.extras.map(() => "?").join(", ");
        const [extras] = await connection.execute(
          `SELECT id, code, name, pricing_unit_code, unit_amount_cents
           FROM extras WHERE is_active = 1 AND code IN (${placeholders})
           ORDER BY id`,
          quote.booking.extras,
        );
        if (extras.length !== quote.booking.extras.length) throw new ValidationError("One or more add-ons are unavailable.");
        for (const extra of extras) {
          const quotedExtra = quote.pricing.extraLines?.find((line) => line.code === extra.code);
          if (!quotedExtra) throw new Error("Invalid quote token.");
          await connection.execute(
            `INSERT INTO reservation_extras (
               reservation_id, extra_id, extra_name, pricing_unit_code, quantity,
               billable_units, unit_amount_cents, total_amount_cents
             ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
            [
              reservationId,
              extra.id,
              quotedExtra.label,
              quotedExtra.pricingUnit,
              quotedExtra.billableUnits,
              quotedExtra.unitAmountCents,
              quotedExtra.totalCents,
            ],
          );
        }
      }

      await connection.execute(
        `INSERT INTO payment_attempts (
           reservation_id, quote_id, provider_code, idempotency_key, status_code,
           amount_cents, tax_amount_cents, currency, client_ip
         ) VALUES (?, ?, 'clover', ?, 'started', ?, ?, ?, INET6_ATON(?))`,
        [reservationId, quoteRow.id, idempotencyKey, quoteRow.total_amount_cents, quoteRow.tax_amount_cents, quoteRow.currency, clientIp],
      );
      await connection.execute(
        "UPDATE quotes SET status_code = 'consumed', consumed_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [quoteRow.id],
      );
      await connection.execute(
        `INSERT INTO reservation_status_history (reservation_id, from_status_code, to_status_code, changed_by, reason)
         VALUES (?, NULL, 'pending_payment', 'checkout', 'Inventory held before Clover charge')`,
        [reservationId],
      );
      await connection.commit();
      return { state: "new", record: { quoteId, idempotencyKey, status: "started" } };
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async complete(quoteId, idempotencyKey, result) {
    return withDeadlockRetry(() => this.completeOnce(quoteId, idempotencyKey, result));
  }

  async completeOnce(quoteId, idempotencyKey, result) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT pa.id, pa.idempotency_key, pa.status_code, pa.amount_cents, pa.reservation_id
         FROM payment_attempts AS pa
         JOIN quotes AS q ON q.id = pa.quote_id
         WHERE q.quote_key = ?
         FOR UPDATE`,
        [quoteId],
      );
      if (rows.length !== 1 || rows[0].idempotency_key !== idempotencyKey) {
        throw new PaymentConflictError("Payment attempt does not match this quote.");
      }
      if (rows[0].status_code === "succeeded") {
        await connection.commit();
        return;
      }
      if (!["started", "unknown"].includes(rows[0].status_code)) {
        throw new PaymentConflictError("A failed payment attempt cannot be changed to succeeded.");
      }
      if (asNumber(rows[0].amount_cents) !== asNumber(result.amountCents)) {
        throw new PaymentConflictError("Clover captured an amount that does not match the reservation.");
      }

      await connection.execute(
        `UPDATE payment_attempts
         SET provider_payment_id = ?, provider_reference = ?, status_code = 'succeeded',
             card_brand = ?, card_last4 = ?, failure_code = NULL, failure_message = NULL,
             is_retryable = 0, result_snapshot = ?, completed_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [result.paymentId, result.reference, result.card?.brand || null, result.card?.last4 || null, JSON.stringify(result), rows[0].id],
      );
      await connection.execute(
        `UPDATE reservations
         SET status_code = 'confirmed', hold_expires_at = NULL, confirmed_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [rows[0].reservation_id],
      );
      await connection.execute(
        `UPDATE site_inventory_days
         SET status_code = 'booked', hold_expires_at = NULL
         WHERE reservation_id = ? AND status_code = 'held'`,
        [rows[0].reservation_id],
      );
      await connection.execute(
        `INSERT INTO reservation_status_history (reservation_id, from_status_code, to_status_code, changed_by, reason)
         VALUES (?, 'pending_payment', 'confirmed', 'clover', 'Captured payment confirmed')`,
        [rows[0].reservation_id],
      );
      await connection.commit();
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async markUnknown(quoteId, idempotencyKey, error) {
    await this.pool.execute(
      `UPDATE payment_attempts AS pa
       JOIN quotes AS q ON q.id = pa.quote_id
       SET pa.status_code = 'unknown', pa.failure_code = ?, pa.failure_message = ?, pa.is_retryable = 1
       WHERE q.quote_key = ? AND pa.idempotency_key = ? AND pa.status_code IN ('started', 'unknown')`,
      [error.code, error.message.slice(0, 255), quoteId, idempotencyKey],
    );
  }

  async fail(quoteId, idempotencyKey, result) {
    return withDeadlockRetry(() => this.failOnce(quoteId, idempotencyKey, result));
  }

  async failOnce(quoteId, idempotencyKey, result) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT pa.id, pa.idempotency_key, pa.status_code, pa.reservation_id
         FROM payment_attempts AS pa
         JOIN quotes AS q ON q.id = pa.quote_id
         WHERE q.quote_key = ?
         FOR UPDATE`,
        [quoteId],
      );
      if (rows.length !== 1 || rows[0].idempotency_key !== idempotencyKey) {
        throw new PaymentConflictError("Payment attempt does not match this quote.");
      }
      if (["declined", "failed"].includes(rows[0].status_code)) {
        await connection.commit();
        return;
      }
      if (rows[0].status_code === "succeeded") {
        throw new PaymentConflictError("A successful payment attempt cannot be changed to failed.");
      }
      const paymentStatus = result.body?.error === "card_declined" ? "declined" : "failed";
      await connection.execute(
        `UPDATE payment_attempts
         SET status_code = ?, failure_code = ?, failure_message = ?, is_retryable = 0,
             result_snapshot = ?, completed_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [paymentStatus, result.body?.error || "payment_failed", String(result.body?.message || "Payment failed").slice(0, 255), JSON.stringify(result), rows[0].id],
      );
      await connection.execute(
        `UPDATE reservations
         SET status_code = 'payment_failed', hold_expires_at = NULL, cancelled_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [rows[0].reservation_id],
      );
      await connection.execute(
        `UPDATE site_inventory_days
         SET status_code = 'available', reservation_id = NULL, hold_expires_at = NULL
         WHERE reservation_id = ? AND status_code = 'held'`,
        [rows[0].reservation_id],
      );
      await connection.execute(
        `INSERT INTO reservation_status_history (reservation_id, from_status_code, to_status_code, changed_by, reason)
         VALUES (?, 'pending_payment', 'payment_failed', 'clover', ?)`,
        [rows[0].reservation_id, String(result.body?.message || "Payment failed").slice(0, 255)],
      );
      await connection.commit();
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordWebhook(value, rawBody) {
    const { createHash } = await import("node:crypto");
    const dedupeKey = createHash("sha256").update(rawBody).digest("hex");
    await this.pool.execute(
      `INSERT IGNORE INTO webhook_events (
         provider_code, dedupe_key, provider_event_id, event_type, provider_object_id, payload
       ) VALUES ('clover', ?, ?, ?, ?, ?)`,
      [
        dedupeKey,
        value.id || value.eventId || null,
        value.type || value.eventType || null,
        value.objectId || value.data?.id || null,
        JSON.stringify(value),
      ],
    );
  }
}

export { HOLD_MINUTES, TERMS_VERSION, isoDateAfter, stayDates };
