# Cha9fa Store security rules

## Production invariants

1. Never put `SUPABASE_SERVICE_ROLE_KEY`, `KICK_CLIENT_SECRET`, `SESSION_SECRET`, or `WATCH_INGEST_SECRET` in browser code, HTML, GitHub Pages, or public documentation.
2. The browser may read active products and the authenticated balance, but it must never be allowed to write a balance or ledger entry.
3. A redemption must be performed by the server through `spend_points_for_order`; the database transaction is the source of truth for the deduction.
4. Watch credits must enter through the private server-to-server watch-award path and the database `grant_watch_points` function. There is no public credit endpoint.
5. Every watch credit must have a unique event key so retries cannot credit the same event twice.
6. Only the configured Kick channel is allowed to generate watch credits.
7. The store must not claim that a browser heartbeat proves a viewer watched the Kick stream. The watch bot/service must provide the authoritative evidence before points are enabled.
8. Admin access is allowlisted by Kick user ID. Admin actions must be authenticated, same-origin, and rate limited.
9. Do not manually edit `store_users.points` in production. Corrections must be represented by an audited ledger operation and a controlled server-side procedure.
10. Keep Supabase RLS enabled. The service role is server-only and bypasses RLS, so its credentials require the same protection as a database password.

## Before launch

- Set all production environment variables in the server host's secret manager.
- Add the real Kick channel slug to `watch_channels` only after the watch source is verified.
- Keep `WATCH_POINTS_PER_MINUTE=0` until the watch bot is tested with real evidence.
- Test duplicate watch events and concurrent redemptions.
- Test an insufficient-balance redemption and verify that no order or debit ledger row is created.
- Test that a non-admin Kick account receives `ADMIN_REQUIRED` from the admin API.
- Verify the deployed site uses HTTPS and `COOKIE_SECURE=true`.
- Rotate any secret immediately if it is ever pasted into chat, a public issue, a browser bundle, or a Git commit.
