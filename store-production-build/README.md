# Cha9fa Store — Production Build

This branch contains the production architecture for the store.

## Current status
- Production database schema: `supabase/schema.sql`
- Five diamond products with the approved point prices
- Server-side atomic point redemption design
- RLS enabled
- No public point-credit function

## Not yet enabled
- Kick OAuth callback/backend deployment
- Public store UI integration
- Admin dashboard
- Watch-time point awarding integration

The existing `main` branch is intentionally left unchanged until the production build is tested.