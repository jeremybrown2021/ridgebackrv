import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PaymentConflictError, PaymentLedger } from "../payment-ledger.js";

test("persists quote use and only allows the same idempotency key", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ridgeback-ledger-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const ledger = new PaymentLedger(directory);
  const quoteId = "aabbccddeeff001122334455";
  const key = "6f9a870e-920f-40ab-b4f1-f3cb9a4c4c1d";

  assert.equal((await ledger.reserve(quoteId, key)).state, "new");
  assert.equal((await ledger.reserve(quoteId, key)).state, "started");
  await ledger.complete(quoteId, key, { ok: true, paymentId: "PAY123" });
  assert.equal((await ledger.reserve(quoteId, key)).record.result.paymentId, "PAY123");

  await assert.rejects(
    () => ledger.reserve(quoteId, "3a19072a-f742-4cdf-88fb-b19b4afdc1a6"),
    PaymentConflictError,
  );
});
