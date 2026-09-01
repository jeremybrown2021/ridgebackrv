# Ridgeback RV deployment

Ready-to-run Docker Compose stack for:

- `ridgebackrv.com` — static site served by Nginx on host port `8080`.
- `book.ridgebackrv.com` — Node.js booking API/site on host port `3000`.
- MySQL 8.4 — private container with persistent storage.
- `migrate` — one-time, idempotent database migration job.

## Requirements

- Docker Engine with Docker Compose v2.
- A Linux server with a TLS reverse proxy.
- Cloudflare DNS pointed at the server.

## Configure

From the repository root:

```bash
cp .env.example .env
cp book.ridgebackrv.com/.env.example book.ridgebackrv.com/.env
```

For production, edit both new `.env` files:

- Set strong, URL-safe database passwords in the root `.env`.
- Set `BOOKING_APP_ORIGIN=https://book.ridgebackrv.com` in the root `.env`.
- Set `TRUST_PROXY=true` in `book.ridgebackrv.com/.env`.
- Configure SMTP and set `AUTH_EXPOSE_RESET_LINKS=false`.
- Add Clover credentials only through the environment; never commit either `.env` file.

## Start and verify

```bash
docker compose up -d --build
docker compose ps -a
curl --fail http://localhost:8080/
curl --fail http://localhost:3000/api/health
```

`main-site`, `booking-site`, and `database` should be `healthy`. The `migrate` service should show `Exited (0)`; this is expected. Migrations run before the booking service starts.

## Cloudflare and reverse proxy

Configure the server's TLS reverse proxy as follows:

| Hostname | Upstream |
| --- | --- |
| `ridgebackrv.com` and `www.ridgebackrv.com` | `http://127.0.0.1:8080` |
| `book.ridgebackrv.com` | `http://127.0.0.1:3000` |

Proxy only ports `80` and `443` publicly. Keep `3000`, `8080`, and MySQL private. Use a valid origin TLS certificate, then enable the Cloudflare proxy for the DNS records.

## Operations

```bash
# Logs
docker compose logs --tail=100 -f

# Deploy updated code
docker compose up -d --build

# Stop without deleting database data
docker compose down
```

MySQL data is stored in the `ridgeback_mysql_data` Docker volume. Back it up before server maintenance. Do not run `docker compose down -v` unless permanent database deletion is intended.

## Production blockers

- Clover is currently sandbox-only. The application intentionally blocks production Clover mode until the live reservation-hold integration is implemented and tested.
- Initial migrations insert placeholder RV site inventory. Replace it with the client's real sites, availability, rates, and extras before accepting bookings.
- Complete staging tests for account email, checkout, payment declines, webhooks, and database restore before launch.
