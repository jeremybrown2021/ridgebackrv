# Ridgeback RV Clover integration

This folder now contains a dependency-free Node.js payment service and a Clover-hosted iframe checkout. Raw card numbers and CVVs go directly from the customer's browser to Clover; they never pass through Ridgeback's Node server.

## Payment flow

1. The browser asks `POST /api/checkout/quote` for a short-lived, signed quote.
2. The server validates the stay and calculates the authoritative price in integer cents.
3. Clover's hosted iframe tokenizes the card and returns a single-use `clv_` token.
4. The browser sends only that token, the signed quote, guest details, and a UUID v4 idempotency key to `POST /api/payments/clover/charge`.
5. The Node server verifies the quote and calls Clover's Ecommerce Service API with the private token, browser IP, and the same idempotency key.
6. MySQL stores the quote, inventory hold, reservation, and payment attempt. Unique idempotency constraints prevent a quote from being charged using a different attempt and return the stored result for safe retries.

Payments are disabled by default. Production payments are hard-blocked in this build because the live QloApps reservation and inventory code is not present in this workspace. That guard must only be removed as part of implementing and testing the reservation-hold adapter.

## Local setup

Requirements: Node.js 20.11 or newer, MySQL 8.0+, and a Clover sandbox test merchant.

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Run `npm install`, `npm run db:migrate`, and `npm run db:check`.
3. In the Clover test Merchant Dashboard, create an Ecommerce API token with integration type **Hosted iFrame + API/SDK**.
4. Add the sandbox Merchant ID, Public Token, and Private Token to `.env`.
5. Generate a random `CLOVER_QUOTE_SECRET` using the command shown in `.env.example`.
6. Set `PAYMENTS_ENABLED=true`, leaving `CLOVER_ENVIRONMENT=sandbox`.
7. Run `npm start` and open `http://localhost:3000/quick-order/`.
8. Run `npm test` or `npm run check` before deployment.

The application uses `mysql2` with a bounded connection pool and parameterized statements. Migrations are recorded in `schema_migrations` with SHA-256 checksums.

## Environment variables

| Variable | Purpose | Exposure |
| --- | --- | --- |
| `DATABASE_URL` | MySQL connection URL, including the database name | Secret; server only |
| `DB_CONNECTION_LIMIT` | Maximum connections opened by this Node process | Server configuration |
| `CLOVER_MERCHANT_ID` | Identifies the single Clover merchant and configures the iframe | Public to the browser |
| `CLOVER_PUBLIC_TOKEN` | Tokenizes cards in Clover's hosted iframe | Public to the browser |
| `CLOVER_PRIVATE_TOKEN` | Authorizes server-to-server charges | Secret; server only |
| `CLOVER_QUOTE_SECRET` | Signs authoritative, expiring server quotes | Secret; server only |
| `CLOVER_WEBHOOK_AUTH_CODE` | Verifies standard Clover REST webhook notifications | Secret; server only |
| `CLOVER_ENVIRONMENT` | `sandbox` or `production` | Server configuration |
| `PAYMENTS_ENABLED` | Explicit payment kill switch | Server configuration |
| `APP_ORIGIN` | Exact browser origin allowed to submit payment requests | Server configuration |
| `TRUST_PROXY` | Uses the first trusted `X-Forwarded-For` address for Clover | Set `true` only behind a controlled proxy |

Never put the private token, quote secret, or webhook auth code into HTML, browser JavaScript, logs, screenshots, tickets, or chat messages. Transfer them through the client's password manager or deployment secret store.

## Required before production

The payment component is sandbox-ready, but the following client decisions and access are still required before a live switch:

- Live QloApps source repository or SSH/SFTP access and deployment procedure.
- QloApps database/API access or a documented booking service that can create a temporary inventory hold before a charge, confirm it after payment, and release it after a decline. Payment must not be enabled in production without this transaction boundary.
- Confirmed site catalog, authoritative rates, add-on rules, occupancy limits, discounts, deposits, convenience fees, and tax calculation. The current implementation applies the client-confirmed 17% tax to the full site-and-add-on subtotal.
- Confirmation that full immediate capture is required. The current implementation sends `capture: true`. If the client wants authorization now and capture only after manual approval, the flow must use pre-authorization and a later capture endpoint instead.
- Clover sandbox Merchant ID plus the sandbox Public and Private Ecommerce API tokens.
- The production Merchant ID plus production Public and Private Ecommerce API tokens after sandbox acceptance.
- Confirmation whether Clover 3-D Secure is enabled for this merchant. If enabled, the Clover 3DS SDK challenge/finalization flow must be added and tested before launch.
- The production HTTPS origin (`https://book.ridgebackrv.com`), proxy/load-balancer details, and production MySQL credentials with TLS.
- Receipt text, statement descriptor, refund/cancellation workflow, and the staff member responsible for payment reconciliation in Clover.
- A public HTTPS webhook URL, event subscriptions, and Clover webhook auth code if asynchronous reconciliation events are required.

## Production operations

- Run the Node service behind HTTPS and a controlled reverse proxy. Set `APP_ORIGIN` to the exact public origin and only set `TRUST_PROXY=true` when that proxy overwrites `X-Forwarded-For`.
- Run migrations once during deployment before starting new application instances. Back up MySQL and verify `/api/health` reports the expected database after deploy.
- Do not retry an uncertain payment with a new quote, token, or idempotency key. The checkout deliberately retains and retries the same payment attempt after a timeout.
- Validate the payment ID and captured amount during booking reconciliation. Never mark a reservation paid from a browser-only success state.
- Test approvals, declines, duplicate clicks, timeouts, expired quotes, refunds, webhook authentication, and inventory-hold release in Clover sandbox before switching to production credentials.
