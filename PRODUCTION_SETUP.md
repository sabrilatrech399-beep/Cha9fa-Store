# Cha9fa Store — Production Setup

## 1. Supabase

Run `supabase/schema.sql` in the Supabase SQL editor.

The browser must never receive the Supabase service/secret key. The server uses it for the private store API and the atomic redemption RPC.

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

## 3. Kick OAuth

The server uses Kick OAuth 2.1 Authorization Code + PKCE with the `user:read` scope. The authorization endpoint is `https://id.kick.com/oauth/authorize` and the token endpoint is `https://id.kick.com/oauth/token`.

The server validates OAuth state and PKCE, creates a server-side session, and stores only a hash of the session token in Supabase.

## 4. Store redemption

The client only displays the balance. The server determines the authenticated Kick account and calls the database redemption RPC. The database locks the user row, verifies the active product and balance, creates the order, deducts points, and writes the debit ledger entry in one transaction.

## 5. Points source

Do not add client-side point-award endpoints.

The approved source is `watch` only. The watch-award service is intentionally not enabled yet because the current official Kick Public API does not expose individual viewer watch-time/presence data. Until Kick provides a supported signal, the store must not pretend that a browser heartbeat is proof of viewing; such a heartbeat can be forged.

## 6. Admin

Open `/admin.html` while authenticated with a Kick account whose ID is listed in `ADMIN_KICK_USER_IDS`.

The dashboard is read-only: it shows current balances and recent redemption records, including the player name, country, game ID, points before, and points after.

## 7. Deployment

Run the server from the `server` directory with Node 20+ and `npm start`. The server also serves the repository root as the storefront, so the store and API can share one HTTPS origin.

Do not deploy this production branch with the old bot service. The bot remains untouched and will be integrated separately after the store is finished.
