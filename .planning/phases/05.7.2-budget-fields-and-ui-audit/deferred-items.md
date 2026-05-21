# Deferred Items — 05.7.2

Items observed during execution but OUT OF SCOPE (pre-existing on base commit `98bbdb1`,
unrelated to budget fields / UI audit).

## Pre-existing tsc errors at base

`./node_modules/.bin/tsc --noEmit` already fails on `98bbdb1` before any of our changes:

1. `src/inngest/functions/__tests__/cronLive.test.ts:200` — `ShopifyProductRow` shape
   mismatch in the test mock. The mock's `productRows` entry only has
   `product_id` + `net_revenue_cad` but the type now requires `gross_revenue_cad`,
   `units`, `orders`, `product_title` (added in commit `98bbdb1`). Test passes at
   runtime because the fields go unread by the cron handler in that path.

2. `src/lib/__tests__/shopifyRevenueRefunds.test.ts:610/634/661/688` — `ShopifyOrderInput`
   identifier is unresolved. Likely a missing import after a refactor.

Both files predate this plan and are unrelated to budget fields. Fix is owed by
whoever maintains the cronLive + refunds test suites (likely the same person who
landed `98bbdb1`).

## Threat surface flagged for follow-up

`fetchMetaBudgets` issues 3 HTTP requests per cron-daily run (one per store, three
stores = 9/day). All against `graph.facebook.com` with the same per-store token
already in scope for `/insights`. No new auth surface; no new secret storage.
