import assert from "node:assert/strict";
import test from "node:test";
import { calculatePrice, normalizeBooking, ValidationError } from "../pricing.js";

const now = new Date("2026-08-24T12:00:00Z");

test("normalizes booking input and calculates all money in cents", () => {
  const booking = normalizeBooking({
    arrival: "2026-09-15",
    nights: 3,
    sites: 2,
    adults: 2,
    children: 1,
    childAges: [8],
    siteType: "standard",
    extras: ["vehicle", "pet", "vehicle"],
  }, now);

  assert.deepEqual(booking.extras, ["vehicle", "pet"]);
  assert.deepEqual(calculatePrice(booking), {
    currency: "usd",
    siteLabel: "Full Hookup Site",
    baseCents: 39_000,
    addOnCents: 2_400,
    subtotalCents: 41_400,
    taxCents: 7_038,
    totalCents: 48_438,
  });
});

test("rejects invalid occupancy and unknown prices", () => {
  assert.throws(
    () => normalizeBooking({
      arrival: "2026-09-15",
      nights: 3,
      sites: 2,
      adults: 1,
      children: 0,
      siteType: "standard",
      extras: [],
    }, now),
    ValidationError,
  );

  assert.throws(
    () => normalizeBooking({
      arrival: "2026-09-15",
      nights: 3,
      sites: 1,
      adults: 1,
      children: 0,
      siteType: "client-injected-rate",
      extras: [],
    }, now),
    /valid site type/i,
  );
});

test("allows up to six guests per site with at least one adult", () => {
  const baseBooking = {
    arrival: "2026-09-15",
    nights: 1,
    sites: 1,
    siteType: "standard",
    extras: [],
  };

  assert.doesNotThrow(() => normalizeBooking({
    ...baseBooking,
    adults: 6,
    children: 0,
  }, now));

  assert.doesNotThrow(() => normalizeBooking({
    ...baseBooking,
    adults: 1,
    children: 5,
    childAges: [0, 4, 7, 10, 14],
  }, now));

  assert.throws(() => normalizeBooking({
    ...baseBooking,
    adults: 0,
    children: 6,
    childAges: [1, 2, 3, 4, 5, 6],
  }, now), ValidationError);

  assert.throws(() => normalizeBooking({
    ...baseBooking,
    adults: 1,
    children: 6,
    childAges: [1, 2, 3, 4, 5, 6],
  }, now), /capacity/i);
});

test("requires one valid age for every child", () => {
  const baseBooking = {
    arrival: "2026-09-15",
    nights: 1,
    sites: 1,
    adults: 1,
    children: 2,
    siteType: "standard",
    extras: [],
  };

  assert.throws(() => normalizeBooking({
    ...baseBooking,
    childAges: [4],
  }, now), /age for every child/i);

  assert.throws(() => normalizeBooking({
    ...baseBooking,
    childAges: [4, 15],
  }, now), /valid age/i);

  assert.deepEqual(normalizeBooking({
    ...baseBooking,
    childAges: [0, 14],
  }, now).childAges, [0, 14]);
});
