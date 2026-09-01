import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "../app.js";
import { PaymentLedger } from "../payment-ledger.js";

function futureDate(days = 7) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("quotes on the server and charges the verified amount once", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ridgeback-app-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const calls = [];
  const cloverClient = {
    async createCharge(input) {
      calls.push(input);
      return {
        ok: true,
        paymentId: "PAY123",
        reference: "RBAABBCCDDEE",
        amountCents: input.quote.pricing.totalCents,
        currency: "usd",
        paid: true,
        captured: true,
      };
    },
  };
  const config = {
    projectRoot,
    appOrigin: "http://localhost",
    trustProxy: false,
    paymentsEnabled: true,
    ledgerDirectory: directory,
    clover: {
      environment: "sandbox",
      merchantId: "MERCHANT123",
      publicToken: "public-token",
      privateToken: "private-token",
      quoteSecret: "a-secure-test-secret-that-is-longer-than-32-characters",
      webhookAuthCode: "",
      apiBaseUrl: "https://scl-sandbox.dev.clover.com",
      sdkUrl: "https://checkout.sandbox.dev.clover.com/sdk.js",
    },
  };
  const handler = createRequestHandler({
    config,
    cloverClient,
    ledger: new PaymentLedger(directory),
    staticRoot: projectRoot,
  });
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const quoteResponse = await fetch(`${baseUrl}/api/checkout/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      booking: {
        arrival: futureDate(),
        nights: 2,
        sites: 1,
        adults: 2,
        children: 0,
        siteType: "standard",
        extras: ["vehicle"],
      },
    }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = await quoteResponse.json();
  assert.equal(quote.pricing.totalCents, 16_380);

  const idempotencyKey = "6f9a870e-920f-40ab-b4f1-f3cb9a4c4c1d";
  const chargeRequest = {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      source: "clv_TESTTOKEN123",
      quoteToken: quote.quoteToken,
      acceptedTerms: true,
      guest: {
        fullName: "Ridgeback Test Guest",
        email: "guest@example.com",
        phone: "+1 713 555 0142",
      },
    }),
  };

  const firstCharge = await fetch(`${baseUrl}/api/payments/clover/charge`, chargeRequest);
  assert.equal(firstCharge.status, 200);
  assert.equal((await firstCharge.json()).paymentId, "PAY123");

  const repeatedCharge = await fetch(`${baseUrl}/api/payments/clover/charge`, chargeRequest);
  assert.equal(repeatedCharge.status, 200);
  assert.equal((await repeatedCharge.json()).paymentId, "PAY123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quote.pricing.totalCents, 16_380);
});

test("returns the branded 404 page with the correct status", async (context) => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const config = {
    projectRoot,
    appOrigin: "http://localhost",
    trustProxy: false,
    paymentsEnabled: false,
    clover: { environment: "sandbox", sdkUrl: "https://checkout.sandbox.dev.clover.com/sdk.js" },
  };
  const handler = createRequestHandler({ config, cloverClient: {}, ledger: {}, staticRoot: projectRoot });
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => new Promise((resolveClose) => server.close(resolveClose)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/missing-page`);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /page not found/i);
});
