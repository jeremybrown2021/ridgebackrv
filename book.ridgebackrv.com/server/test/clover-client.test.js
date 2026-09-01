import assert from "node:assert/strict";
import test from "node:test";
import { CloverClient, CloverGatewayError } from "../clover-client.js";

const config = {
  apiBaseUrl: "https://scl-sandbox.dev.clover.com",
  privateToken: "private-test-token",
};

const quote = {
  quoteId: "aabbccddeeff001122334455",
  booking: { arrival: "2026-09-15", nights: 1, sites: 1, siteType: "standard" },
  pricing: { currency: "usd", siteLabel: "Full Hookup Site", taxCents: 1105, totalCents: 7605 },
};

test("creates a captured Clover charge with required security headers", async () => {
  let received;
  const client = new CloverClient(config, async (url, options) => {
    received = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "CHARGE123",
      amount: 7605,
      currency: "usd",
      paid: true,
      captured: true,
      source: { brand: "VISA", last4: "1111" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await client.createCharge({
    quote,
    source: "clv_TESTTOKEN123",
    guest: { email: "guest@example.com" },
    idempotencyKey: "6f9a870e-920f-40ab-b4f1-f3cb9a4c4c1d",
    clientIp: "203.0.113.7",
  });

  assert.equal(received.url, "https://scl-sandbox.dev.clover.com/v1/charges");
  assert.equal(received.options.headers["x-forwarded-for"], "203.0.113.7");
  assert.equal(received.options.headers["idempotency-key"], "6f9a870e-920f-40ab-b4f1-f3cb9a4c4c1d");
  assert.equal(received.body.amount, 7605);
  assert.equal(received.body.source, "clv_TESTTOKEN123");
  assert.equal(received.body.capture, true);
  assert.equal(result.paymentId, "CHARGE123");
});

test("maps a Clover decline to a definite non-retryable error", async () => {
  const client = new CloverClient(config, async () => new Response(
    JSON.stringify({ message: "Card declined" }),
    { status: 402, headers: { "content-type": "application/json" } },
  ));

  await assert.rejects(
    () => client.createCharge({
      quote,
      source: "clv_TESTTOKEN123",
      guest: { email: "guest@example.com" },
      idempotencyKey: "6f9a870e-920f-40ab-b4f1-f3cb9a4c4c1d",
      clientIp: "203.0.113.7",
    }),
    (error) => error instanceof CloverGatewayError && error.code === "card_declined" && error.retryable === false,
  );
});
