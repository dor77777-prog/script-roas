# Activity-Feed Source/Platform Attribution — Design

**Date:** 2026-06-06 · **Project:** script-roas (existing single-tenant prod) · **Deploy:** `git push origin main`

## Goal

Show, on the **real-time activity feed**, which ad platform each event came from:
- **#1 Sales** — platform badge on every `sale` event (server-side; data already exists).
- **#2 (light) Add-to-cart** — platform badge on `add_to_cart` events, via first-touch UTM/click-id capture in the storefront pixel/beacon.

**Locked scope decisions (2026-06-06):** do #1 + ATC-source now on the old app. **DEFERRED to the new multi-tenant app:** the "cart-updating / add-remove coalescing / removal detection" (Shopify web pixels emit no native remove-from-cart event; no cart/session id today — design it properly with pixel-per-tenant in the new app).

**Hard constraint (non-negotiable):** never slow the storefront. All storefront capture stays **off-main-thread (sandboxed Custom Pixel)**, **fire-and-forget**, server acks **204 instantly**. #1 is pure server-side (zero browser impact).

**Invariant:** read-only / CAPI-safe — we only READ click/UTM signals; never write to pixels/CAPI.

---

## A. Data layer

New migration `supabase/migrations/<ts>_add_source_to_store_events.sql`:
```sql
ALTER TABLE store_events ADD COLUMN IF NOT EXISTS source TEXT;
```
Additive, nullable → no writer/reader breaks. (`store_events` is defined in `20260601120000_realtime_activity_feed.sql`.) Value vocabulary = the existing `OrderSource` (`meta-paid` | `google-paid` | `tiktok-paid` | `direct` | `''`/null for refunds & unknown). One column serves both `sale` and `add_to_cart`.

If `store_events` is read via an enriched view, recreate it to expose `source` (DROP+CREATE if `SELECT *`, with a `-- DESTRUCTIVE:` tripwire — mirror the ads_enriched lesson). Verify whether `activity-events` reads the table or a view.

## B. Shared source classifier (factor out, reuse)

The canonical order→source classifier already lives in `src/lib/fetchers/shopify.ts` (~lines 880–950): it takes `{ landing_site, referring_site, note_attributes, source_name }`, parses UTM + `fbclid`/`gclid`/`ttclid` (incl. first-click `ft_*` from `note_attributes`), and returns `source` (+ `fbclidPresent` etc.).

**Extract it into a shared, side-effect-free module** `src/lib/attribution/classifyOrderSource.ts` exporting:
```ts
export function classifyOrderSource(input: {
  landing_site?: string | null;
  referring_site?: string | null;
  note_attributes?: Array<{ name?: string; value?: string }> | null;
  source_name?: string | null;
}): OrderSource;
```
`shopify.ts` keeps calling it (NO behavior change — guard with the existing `orderSourceContract.test.ts` parity test). Both the sale-webhook path (B/§D) and the ATC path (§C) import the SAME helper → the feed badge always matches the dashboard's canonical attribution.

## C. Sale source at ingest (server-side, real-time)

Extend `normalizeOrderEvent` (sale branch, `src/lib/webhooks/normalizeShopifyEvent.ts:185-216`):
1. Widen `OrderPayload` to include `landing_site?`, `referring_site?`, `note_attributes?`, `source_name?` (already present on the `orders/create` webhook payload — just not currently read).
2. `const source = classifyOrderSource({ landing_site, referring_site, note_attributes, source_name });`
3. Add `source` to `NormalizedStoreEvent` + set it on the returned row. Refunds set `source: null`.
4. `insertStoreEvent` (`src/lib/webhooks/store.ts`) writes the new `source` column.
5. Confirm `src/app/api/webhooks/shopify/route.ts` passes the full raw order (with those fields) into `normalizeOrderEvent`. Zero browser impact (server-to-server webhook).

## D. Add-to-cart source (first-touch capture in pixel/beacon)

**Server** (`src/app/api/events/cart/route.ts`): accept optional first-touch attribution fields in the beacon body (`landing_site` / `utm` / `fbclid` / `gclid` / `ttclid` / `referring_site`), classify via `classifyOrderSource`, write `store_events.source`. All existing 204-ack/never-block/dedupe behavior unchanged.

**Storefront snippets (operator-deployed — NOT in this repo's CI):**
- **uzoshop, Zol Plus (Shopify Custom Pixel):** on `page_viewed` (incl. landing), read `init.context.document.location` URL params + `document.referrer`; **persist FIRST non-empty** UTM/click-id to `localStorage` (first-touch). On `product_added_to_cart`, include the persisted value in the existing beacon POST. Stays inside the sandboxed pixel (off-main-thread).
- **usmile360 (Lovable headless):** the existing custom beacon snippet does the same first-touch persist + send.
- Provide the exact snippet text in the plan; the operator pastes it into Shopify Custom Pixel UI + the Lovable project. Document in the User Manual.

**Honest caveats (state in UI/docs):** (1) best-effort — a landing with no click-id ⇒ `direct` ("ישיר"); (2) **Google is weaker** — first-click `gclid` handling is limited (memory: "first-click is Google-blind"); (3) requires touching 3 storefronts incl. the headless Lovable one.

## E. Feed UI — platform badge

`src/components/home/ActivityFeed.tsx` + `src/components/activity/ActivityEventsTab.tsx`: render a platform badge on each `sale` / `add_to_cart` row from `event.source`. Refunds: no platform badge.
- Colors (brand-mirrored, per memory): Meta `#1877f2` · Google `#f4a200` · TikTok `#ff2e7e` · `direct` = neutral chip.
- **WHITE text on the colored chip** (clears WCAG-AA on the vivid fill, per the vivid-band-white-text standard); neutral chip uses muted ink on scrim. Token-driven, light + dark, RTL, via the existing primitives.
- Approved mockup: `docs/superpowers/mockups/2026-06-06-activity-source-badge/feed-badges.html`.
- A small shared `<SourceBadge source={...} />` primitive maps `OrderSource` → label + chip class (one source of truth for both feed surfaces).

## F. Reader

`src/app/api/home/activity-events/route.ts` (+ the shared event type): include `source` in the selected columns + the response type so both feed surfaces receive it. Map `null` → no badge.

## G. Testing (TDD)

- `classifyOrderSource` unit tests on real `landing_site` shapes (fbclid→meta-paid, gclid→google-paid, ttclid→tiktok-paid, utm_source, note_attributes `ft_*` first-click, none→direct); reuse/extend the existing `orderSourceContract` fixtures.
- `normalizeOrderEvent` sale: source set from landing_site; refund: source null.
- `events/cart` route: source classified from beacon first-touch fields; missing → null; still 204 + dedupe.
- DOM: `<SourceBadge>` + a feed row renders the right chip per source, both themes, refund shows none.
- Existing money/feed/contract tests stay green.

## Gates / docs

`tsc` · vitest (node+DOM) · lint · User Manual bump (new badge + the storefront snippet instructions) · ARCHITECTURE note (store_events.source + classifier extraction) · supervised migration → single push.

## Non-goals / deferred

Cart-updating / add-remove coalescing / removal detection → **new multi-tenant app**. No changes to billing/aggregates (feed is display-only). No pixel/CAPI writes.

## Risks

- Storefront snippet is operator-deployed across 3 stores → drift risk; document precisely + verify each store's first ATC event carries a source.
- The enriched-view-vs-table read path for the feed must be checked before assuming the column surfaces (ads_enriched lesson).
- ATC source is best-effort + Google-weak — set expectations in the UI copy so a low ATC-source rate isn't read as a bug.
