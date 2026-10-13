# Deployment

## Single server (simplest)

1. PostgreSQL 14+ with a dedicated user and database.
2. Environment (see `.env.example`): `DATABASE_URL`, `IP_HASH_SALT` (required in production), optional
   `TELEGRAM_BOT_TOKEN`, `PORT`, `FIRST_SEASON_START`.
3. Build and start:
   ```bash
   npm ci
   npm run build          # client/dist
   NODE_ENV=production npm start
   ```
   The server applies migrations on start, creates season 1 if none exists, serves the client and the API on
   one port, and advances the season clock every `SEASON_TICK_SECONDS`.
4. Put it behind HTTPS (nginx, Caddy, a cloud load balancer) and set `TRUST_PROXY=true` so client IPs come from
   `X-Forwarded-For` (leave it `false` when the server is exposed directly, otherwise IPs could be spoofed).
5. Create the first admin: `npm run admin:grant -w server -- <username> superadmin`.

## Docker

```bash
POSTGRES_PASSWORD=... IP_HASH_SALT=... docker compose up --build -d
```

The image builds the client and runs the TypeScript server with `tsx`. (Verified: built and run against
PostgreSQL 16 during development.)

## Scaling notes

* The API is stateless except the in-memory rate limiter and the season tick. For several instances: move rate
  limiting to Redis, and run the season tick on all instances (it is idempotent and uses row locks) or on one.
* All economic writes use row locks, so horizontal scaling does not weaken consistency.
* Season reset is one transaction over all kingdoms; batch it (still idempotent per kingdom) for very large
  player counts.

## Backups

* Nightly `pg_dump -Fc` with retention (e.g. 14 daily, 8 weekly), stored off-host and encrypted.
* **Always** take a dump right before approving rewards and before the season reset.
* Restore drill: `pg_restore -d mini_empire_restore dump.file`, start a server against it, check `/api/health`.

## Telegram Mini App

Step-by-step guide (Turkish): [TELEGRAM_KURULUM.md](TELEGRAM_KURULUM.md). One-click hosting: `render.yaml` (Render Blueprint).
With `TELEGRAM_BOT_TOKEN` and `PUBLIC_URL` set, the server registers the bot webhook and the "Oyna" menu button on start,
and answers `/start` with an "Oyunu Aç" Mini App button.


1. Create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN` on the server.
2. Deploy the game on a public HTTPS URL and configure it as the bot's Mini App / menu button URL.
3. When opened inside Telegram, the client loads `telegram-web-app.js`, sends the raw signed `initData` to
   `POST /api/auth/telegram`, and the server verifies the HMAC signature and freshness before creating or
   finding the account (linked by Telegram user id, never by the client-reported name).
4. Layout already respects safe areas and works at 360 px width; no cookies are needed (bearer tokens).

Not yet verified inside the real Telegram client (requires a bot and public URL).

## Path to Android and iOS

* **Fastest:** wrap the web build with Capacitor (same React UI, add store-compliant login: Sign in with Apple /
  Google mapped to new `/auth/*` providers using the same session mechanism).
* **Native:** reuse `@mini-empire/shared` (pure TypeScript rules, battle engine for replays) in React Native, or
  port the deterministic engine; the server API is client-agnostic.
* Before selling anything in-app: implement store receipt verification on the server, refunds/chargebacks
  handling and the platform rules — the store module is deliberately payment-free today.
