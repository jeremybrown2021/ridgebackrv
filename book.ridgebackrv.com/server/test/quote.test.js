import assert from "node:assert/strict";
import test from "node:test";
import { createQuoteToken, verifyQuoteToken } from "../quote.js";

const secret = "a-secure-test-secret-that-is-longer-than-32-characters";
const booking = { arrival: "2026-09-15", nights: 1, sites: 1, adults: 1, children: 0, childAges: [], siteType: "standard", extras: [] };
const pricing = { currency: "usd", siteLabel: "Full Hookup Site", baseCents: 6500, addOnCents: 0, subtotalCents: 6500, taxCents: 1105, totalCents: 7605 };

test("signs and verifies a short-lived server quote", () => {
  const created = createQuoteToken({ booking, pricing, secret, now: 1_000_000 });
  const verified = verifyQuoteToken(created.token, secret, 1_001_000);
  assert.deepEqual(verified.booking, booking);
  assert.equal(verified.pricing.totalCents, 7605);
});

test("rejects tampered and expired quote tokens", () => {
  const created = createQuoteToken({ booking, pricing, secret, now: 1_000_000 });
  const tampered = `${created.token.slice(0, -1)}x`;
  assert.throws(() => verifyQuoteToken(tampered, secret, 1_001_000), /invalid quote/i);
  assert.throws(() => verifyQuoteToken(created.token, secret, 2_000_000), /expired/i);
});
