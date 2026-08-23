# Cha9fa Store — Production Setup

## 1. Supabase

Run `supabase/schema.sql` in the Supabase SQL editor.

Then run `supabase/production-hardening.sql` once. This creates the private watch-event table and the idempotent watch-award function.

The browser must never receive the Supabase service/secret key. The server uses it for the private store API and the atomic redemption/award paths.

## 2. Server environment

Copy `server/.env.example` into the deployment environment and set real values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET` — long random secret
- `KICK_CLIENT_ID`
- `KICK_CLIENT_SECRET`
- `KICK_REDIRECT_URI` — exact callback registered in Kick
- `ADMIN_KICK_USER_IDS` — comma-separated Kick user IDs allowed to open `/admin.html`
- `COOKIE_SECURE=true` in HTTPS production

The future private watch service also uses:

- `WATCH_INGEST_SECRET` — separate long random secret, never sent to browsers
- `WATCH_CHANNEL_USER_ID` — the exact Kick channel/user ID that is allowed to generate watch credits
- `WATCH_POINTS_PER_MINUTE` — the approved point rate; keep `0` until the verified watch source is ready
- `WATCH_MAX_MINUTES_PER_EVENT` — hard cap per ingestion event

## 3. Kick OAuth

The server uses Kick OAuth 2.1 Authorization Code + PKCE with the `user:read` scope. The authorization endpoint is `https://id.kick.com/oauth/authorize` and the token endpoint is `https://id.kick.com/oauth/token`.

The server validates OAuth state and PKCE, creates a server-side session, and stores only a hash of the session token in Supabase.

## 4. Store redemption

The client only displays the balance. The server determines the authenticated Kick account and calls the database redemption RPC. The database locks the user row, verifies the active product and balance, creates the order, deducts points, and writes the debit ledger entry in one transaction.

The approved catalog is:

- 100 جوهرة — 300 نقطة
- 300 جوهرة — 900 نقطة
- 500 جوهرة — 1,500 نقطة
- 1,000 جوهرة — 3,000 نقطة
- 5,000 جوهرة — 15,000 نقطة

## 5. Points source and anti-tampering

There is no public/client-side point-award endpoint. The database ledger allows credits only when the source is `watch`; redemptions create debit entries tied to an order.

The future watch service uses a private server-to-server endpoint. It requires a separate secret, an exact configured channel ID, a bounded watch duration, and an idempotent `eventKey`. Replaying the same event does not award the points again.

Important: the watch endpoint is **not activated as a fake browser heartbeat**. A browser can forge a heartbeat and that would violate the requirement that points come only from genuine viewing. The endpoint is intentionally waiting for the verified watch signal/bot integration. Until that signal exists, `WATCH_POINTS_PER_MINUTE` must remain `0` and no watch points are generated.

## 6. Guest account and redemption information

A viewer must sign in with Kick before seeing their real balance. When their balance is enough, the matching product button becomes available. At redemption the viewer must provide:

- player name
- country
- game ID

The server validates these fields again; the browser cannot choose the user's point balance or authenticated Kick identity.

## 7. Admin

Open `/admin.html` while authenticated with a Kick account whose ID is listed in `ADMIN_KICK_USER_IDS`.

The dashboard shows current balances, redemption records, the immutable points ledger, and watch events. It does not contain a manual "add points" control. A pending order can be marked **تم التسليم** by the authorized admin account; that action does not change the user's point balance.

## 8. Deployment

**GitHub Pages alone is not sufficient for the production store.** GitHub Pages can serve the static files, but it cannot run the Node/Express API required for Kick OAuth, private sessions, point balances, and atomic redemptions.

The repository includes `render.yaml` for a production Node web service. The Node service serves both the storefront and the API from the same HTTPS origin. After deployment, use the service's HTTPS URL as `PUBLIC_BASE_URL`, and register the exact `/auth/kick/callback` URL in the Kick developer application.

Run both SQL files before accepting real users. Keep all Supabase service-role, Kick client-secret, session, and watch-ingest secrets only in the server's secret environment variables.

Do not deploy this production branch with the old bot service. The bot remains separate and will be integrated after the store is fully verified.
