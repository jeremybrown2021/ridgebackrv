# Ridgeback booking database

The Node application uses the MySQL database named by `DATABASE_URL`. On local Laragon the configured URL is:

```text
mysql://root:@127.0.0.1:3306/ridgebackrv
```

Run migrations and a read-only health/query-plan check with:

```powershell
npm.cmd run db:migrate
npm.cmd run db:check
```

## Main data groups

- Catalog and pricing: `site_types`, `sites`, `rate_plans`, `daily_rates`, `extras`.
- Booking: `quotes`, `reservations`, `reservation_sites`, `reservation_extras`, `site_inventory_days`, `reservation_status_history`.
- Payments and reconciliation: `payment_attempts`, `webhook_events`.
- Accounts: `users`, `auth_sessions`, `password_reset_tokens`; authenticated checkouts link new reservations through `reservations.user_id`.
- Fixed workflow values: the `*_statuses` and `pricing_units` lookup tables.

Passwords are stored as memory-hard scrypt hashes. Session and password-reset secrets are never stored directly; MySQL retains only fixed-length SHA-256 token hashes. Localhost exposes reset links in the forgot-password response for development. Production requires `SMTP_HOST` when `AUTH_EXPOSE_RESET_LINKS=false`; configure `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USER`/`SMTP_PASSWORD`, and `AUTH_FROM_EMAIL` for delivery.

The initial migration creates five placeholder sites for each checkout site type. Every placeholder has `is_placeholder = 1` and a `DEV-` site code. Replace these records with the client's real site inventory before any production deployment.

Money is stored as integer cents. Child ages are validated as integers from 0 through 14 and retained in `quotes.booking_snapshot`; reservations access the same immutable snapshot through `quote_id`. Card numbers, CVVs, Clover private credentials, and one-time `clv_` source tokens must never be stored in MySQL.

Migration files are append-only after application. To change the schema, add the next numbered migration rather than editing an applied file; the runner rejects checksum changes.
