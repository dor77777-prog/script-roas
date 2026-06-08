# First-Touch UTM Passthrough → Maximal Per-Campaign Attribution Certainty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Run all commands from `dashboard-web/` unless noted.

**Goal:** Recover the first-touch campaign/ad-set/ad UTM ids that Shopify's last-click `landing_site` drops — by writing `_ft_*` cart attributes at the storefront (themed + headless) and using first-touch as a fallback in the existing analyzers — raising per-campaign certainty across all 3 stores, with zero pixel/CAPI events and zero platform-$ regression.

**Architecture:** (1) Analyzer matchers (`lib/attributionAnalysis.ts`) gain a first-touch fallback tier — pure functions, the hook already passes full `OrderAttributionRow` (which carries `firstUtm*`). (2) A new **theme** snippet writes `_ft_*` Shopify cart attributes (Custom Pixels are sandboxed and can't), surfaced via the `storeSnippets.ts` generator + the source-of-truth doc; the headless Lovable snippet sets the same attributes via the Storefront API. (3) A CAPI-safe guard proves no pixel calls. (4) De-dup the duplicate ROAS/value cards. Phase 2 (Shopify `customerJourneySummary` GraphQL) is a SEPARATE later plan, gated on Protected Customer Data approval — out of scope here.

**Tech Stack:** TypeScript, Vitest (node + jsdom config `vitest.config.dom.ts`), Next.js, the existing attribution lib + storefront snippet generator.

**Spec:** `docs/superpowers/specs/2026-06-08-attribution-first-touch-passthrough-design.md`

---

## Reference facts (read before starting)

- The order writer ALREADY reads first-touch from `note_attributes`: `classifyOrderSource.ts` folds `note_attributes` into `params`, strips a leading `_` (`_ft_x` → `ft_x`), and `ftGet('utm_id')` reads `ft_utm_id`. So storefront cart attributes named **`_ft_utm_id / _ft_utm_campaign / _ft_utm_term / _ft_utm_content / _ft_utm_source / _ft_utm_medium / _ft_fbclid / _ft_gclid / _ft_ttclid / _ft_set_at`** populate `OrderAttributionRow.firstUtm*` with NO writer change.
- `OrderAttributionRow` (in `lib/ordersAttribution.ts`) carries: `utmId, utmCampaign, utmTerm, utmContent` (last-touch) AND `firstUtmId, firstUtmCampaign, firstUtmTerm, firstUtmContent` (first-touch).
- Shopify **cart attributes whose name starts with `_` are "private"** — hidden from the customer but DO persist to `order.note_attributes`. Perfect for `_ft_*`.
- Shopify **Custom Pixels are sandboxed** (no `localStorage`/DOM/cart). The `_ft_*` cart-attribute WRITE must be a **theme** snippet (`/cart/update.js`), separate from the existing Custom Pixel (which keeps feeding the cart beacon).

---

## Task 1: Analyzer first-touch fallback (campaign / ad-set / ad)

**Files:**
- Modify: `dashboard-web/src/lib/attributionAnalysis.ts` (`orderMatchesCampaign` ~257-309, `analyzeAttributionForAdSet` matched-filter ~828-833, `analyzeAttributionForAd` matched-filter ~888-893)
- Test: `dashboard-web/src/lib/__tests__/orderMatchesCampaignFirstTouch.test.ts` (new), and extend `dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts` if present.

**Rule:** last-click wins when present; first-touch fills the gap ONLY when last-click carries no signal for that grain. Never reassign an order already matched by last-click (no double-count).

- [ ] **Step 1: Write failing tests** — create `orderMatchesCampaignFirstTouch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orderMatchesCampaign } from '@/lib/attributionAnalysis';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const base: OrderAttributionRow = {
  date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', orderId: '1',
  totalCad: 100, source: 'meta-paid',
  utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
  fbclidPresent: true, gclidPresent: false, referringSite: '',
  utmId: '', utmTerm: '', lineItems: [], customerId: null, orderCreatedAt: null,
  isFirstOrder: null, firstTouchSource: null,
  firstFbclidPresent: false, firstGclidPresent: false, firstTtclidPresent: false,
  firstUtmSource: null, firstUtmMedium: null, firstUtmCampaign: null,
  firstUtmContent: null, firstUtmId: null, firstUtmTerm: null, firstSeenAt: null,
  paymentGateway: null,
};
const camp = { campaignName: 'Sale', campaignId: 'c1', storeId: 'uzoshop', platform: 'Meta' };

describe('orderMatchesCampaign — first-touch fallback', () => {
  it('matches via first_utm_id when last-touch utm is absent', () => {
    expect(orderMatchesCampaign({ ...base, firstUtmId: 'c1' }, camp)).toBe(true);
  });
  it('matches via first_utm_campaign (name) when last-touch utm is absent', () => {
    expect(orderMatchesCampaign({ ...base, firstUtmCampaign: 'Sale' }, camp)).toBe(true);
  });
  it('last-touch wins: last utm_id=c2 (mismatch) does NOT fall back to first_utm_id=c1', () => {
    expect(orderMatchesCampaign({ ...base, utmId: 'c2', firstUtmId: 'c1' }, camp)).toBe(false);
  });
  it('no signal anywhere → no match', () => {
    expect(orderMatchesCampaign(base, camp)).toBe(false);
  });
  it('Google: first_utm_id fallback matches numeric id when last absent', () => {
    const g = { campaignName: 'x', campaignId: '999', storeId: 'uzoshop', platform: 'Google' };
    expect(orderMatchesCampaign({ ...base, source: 'google-paid', firstUtmId: '999' }, g)).toBe(true);
    expect(orderMatchesCampaign({ ...base, source: 'google-paid', utmId: '111', firstUtmId: '999' }, g)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → RED.** `npx vitest run src/lib/__tests__/orderMatchesCampaignFirstTouch.test.ts` — expect failures (no fallback yet).

- [ ] **Step 3: Implement the fallback** in `orderMatchesCampaign`. Replace the Google block + the Meta/TikTok tail so first-touch is used only when last-touch is absent:

```ts
  if (campaign.platform === 'Google') {
    if (!campaign.campaignId) return false;
    const wantId = campaign.campaignId.trim();
    // Last-click authoritative when present.
    if (order.utmId || order.utmCampaign) {
      return (!!order.utmId && order.utmId.trim() === wantId)
          || (!!order.utmCampaign && order.utmCampaign.trim() === wantId);
    }
    // First-touch fallback (last-click carried no campaign signal).
    return (!!order.firstUtmId && order.firstUtmId.trim() === wantId)
        || (!!order.firstUtmCampaign && order.firstUtmCampaign.trim() === wantId);
  }
  if (campaign.platform !== 'Meta' && campaign.platform !== 'TikTok') return false;

  // Tier 1 — last-click utm_id authoritative when present.
  if (order.utmId) {
    return !!campaign.campaignId && order.utmId.trim() === campaign.campaignId.trim();
  }
  // Tier 2 — last-click utm_campaign name match.
  if (order.utmCampaign) {
    return order.utmCampaign.trim().toLowerCase() === campaign.campaignName.trim().toLowerCase();
  }
  // Tier 3 — FIRST-TOUCH fallback (last-click carried no campaign signal at all).
  if (order.firstUtmId) {
    return !!campaign.campaignId && order.firstUtmId.trim() === campaign.campaignId.trim();
  }
  if (order.firstUtmCampaign) {
    return order.firstUtmCampaign.trim().toLowerCase() === campaign.campaignName.trim().toLowerCase();
  }
  return false;
```

- [ ] **Step 4: Add ad-set + ad fallback** — in `analyzeAttributionForAdSet` replace the `matchedOrders` predicate's final line:

```ts
    const lastTerm = o.utmTerm && o.utmTerm.trim();
    if (lastTerm) return lastTerm === adSet.adSetId.trim();
    return !!o.firstUtmTerm && o.firstUtmTerm.trim() === adSet.adSetId.trim();
```

and in `analyzeAttributionForAd`:

```ts
    const lastContent = o.utmContent && o.utmContent.trim();
    if (lastContent) return lastContent === ad.adId.trim();
    return !!o.firstUtmContent && o.firstUtmContent.trim() === ad.adId.trim();
```

- [ ] **Step 5: Add ad-set/ad fallback tests** — append to the new test file: an ad-set order with `utmTerm=''` + `firstUtmTerm='as1'` matches `analyzeAttributionForAdSet({adSetId:'as1',...})` (deterministicOrders ≥ 1); last-term-present mismatch does NOT fall back. Same for ad via `firstUtmContent`.

- [ ] **Step 6: Run → GREEN.** `npx vitest run src/lib/__tests__/orderMatchesCampaignFirstTouch.test.ts` and the full attribution suite `npx vitest run src/lib/__tests__/ | grep -i attribution`. `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit** `feat(attribution): first-touch fallback in campaign/ad-set/ad matchers (last-click wins, first-touch fills gaps)`

---

## Task 2: Surface ad-level attribution (wire the deferred analyzer)

**Files:**
- Modify: `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` (the block that notes `analyzeAttributionForAd` is DEFERRED)
- Read first: the whole `useCampaignAttribution.ts` + `src/components/campaign-drawer/CampaignDrawerAds.tsx` (the ad list — where the per-ad trust chip should appear, reusing the SAME chip pattern `CampaignDrawerAdSets.tsx` already uses for ad-sets).
- Test: `dashboard-web/src/lib/hooks/__tests__/useCampaignAttributionAdLevel.dom.test.tsx` (new, jsdom).

**Scope guard:** reuse the existing ad-set trust-chip presentation at ad grain — NO new bespoke UI design (so no mockup gate). If `CampaignDrawerAds` has no per-row attribution slot and adding one is more than a chip, STOP and report `DONE_WITH_CONCERNS` describing what a minimal surfacing needs; do not invent a new layout.

- [ ] **Step 1: Write a failing hook test** that, given a campaign with ads carrying `adId` and orders whose `utmContent`/`firstUtmContent` equal those ids, the hook returns a per-ad `AttributionAnalysis` map (non-null `trust`) for the matched ad.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** — compute `analyzeAttributionForAd(...)` per ad in the hook (mirror the existing `analyzeAttributionForAdSet` loop) and expose it on the hook's return; render the existing trust chip per ad row in `CampaignDrawerAds.tsx` (same `TRUST_TONE`/`Badge` the ad-set list uses).
- [ ] **Step 4: Run → GREEN.** `npm run test:components -- src/lib/hooks/__tests__/useCampaignAttributionAdLevel.dom.test.tsx`; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `feat(attribution): surface per-ad attribution trust in the ads drawer (wire deferred analyzeAttributionForAd)`

---

## Task 3: Themed `_ft_*` cart-attribute snippet (generator + docs)

**Files:**
- Modify: `dashboard-web/src/lib/storeSnippets.ts` (add a themed theme-snippet template + include it in the `themed` return)
- Modify: `docs/storefront-snippets/first-touch-attribution.md` (new "Section 1b — Theme snippet: `_ft_*` cart attributes")
- Test: `dashboard-web/src/lib/__tests__/storeSnippets.test.ts` (extend)

**Design contract:** The themed snippet is a SEPARATE block from the Custom Pixel (which keeps feeding the cart beacon). It (a) persists entry UTM to `localStorage._ft_attr` (first-touch, guarded), (b) parses that bag into `_ft_*` cart attributes, (c) writes them via `/cart/update.js` exactly once per session (guarded by `sessionStorage._ft_cart_written`). NO `fbq`/`gtag`/`ttq`/track calls.

- [ ] **Step 1: Write failing tests** in `storeSnippets.test.ts`:

```ts
it('themed snippet writes _ft_* cart attributes via /cart/update.js (no pixel calls)', () => {
  const r = generateStoreSnippet({ storeId: 's', cartPublicToken: 'tok', allowedOrigins: [], isHeadless: false });
  const all = [r.primary, r.secondary, r.note].filter(Boolean).join('\n');
  expect(all).toContain('/cart/update.js');
  expect(all).toContain('_ft_utm_id');
  expect(all).toContain('_ft_set_at');
  expect(all).not.toMatch(/\bfbq\(|\bgtag\(|\bttq\(|analytics\.track|dataLayer\.push/);
});
```

- [ ] **Step 2: Run → RED.** `npx vitest run src/lib/__tests__/storeSnippets.test.ts`
- [ ] **Step 3: Implement** — add the template + include it in the themed result. Add to `storeSnippets.ts`:

```ts
/**
 * Themed THEME snippet (NOT the Custom Pixel — that's sandboxed and can't touch
 * the cart). Persists first-touch UTM to localStorage and writes it as `_ft_*`
 * Shopify cart attributes via the Cart AJAX API, so the order's note_attributes
 * carry the first-click campaign/ad-set/ad ids (the dashboard reads `_ft_*`).
 * Idempotent per session. CAPI-safe: NO pixel/track/CAPI calls — only
 * localStorage + /cart/update.js. Paste in the theme (theme.liquid), NOT the
 * Custom Pixel.
 */
const THEMED_CART_ATTR_TEMPLATE = `<script>
(function () {
  try {
    var KEEP = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    var sp = new URLSearchParams(location.search);
    var got = {};
    KEEP.forEach(function (k) { var v = sp.get(k); if (v) got[k] = v; });
    var stored = localStorage.getItem("_ft_attr");
    if (Object.keys(got).length && !stored) {
      stored = "?" + Object.keys(got).map(function (k) { return k + "=" + encodeURIComponent(got[k]); }).join("&");
      localStorage.setItem("_ft_attr", stored);
    }
    if (!stored) return;
    if (sessionStorage.getItem("_ft_cart_written")) return;
    var bag = new URLSearchParams(stored);
    var attrs = {};
    KEEP.forEach(function (k) { var v = bag.get(k); if (v) attrs["_ft_" + k] = v; });
    if (!Object.keys(attrs).length) return;
    attrs["_ft_set_at"] = new Date().toISOString();
    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs })
    }).then(function () { sessionStorage.setItem("_ft_cart_written", "1"); }).catch(function () {});
  } catch (e) {}
})();
</script>`;
```

In the themed branch of `generateStoreSnippet`, return the cart-attr template as `secondary` and update `note` to instruct pasting it in the theme:

```ts
  return {
    kind: 'themed',
    primary: THEMED_PIXEL_TEMPLATE.split(TOKEN_PLACEHOLDER).join(cartPublicToken),
    secondary: THEMED_CART_ATTR_TEMPLATE,
    note:
      'primary → Shopify admin → Settings → Customer events → Add custom pixel. ' +
      'secondary → paste in the THEME (theme.liquid, before </body>) — it writes _ft_* cart ' +
      'attributes so orders carry the first-click campaign/ad ids. Do NOT put the secondary in the Custom Pixel (sandboxed).',
  };
```

- [ ] **Step 4: Update the doc** — add "Section 1b" to `docs/storefront-snippets/first-touch-attribution.md` with the same `THEMED_CART_ATTR_TEMPLATE` block (verbatim), explaining: paste in the theme, it writes `_ft_*` cart attributes → order note_attributes → first-click campaign attribution; CAPI-safe; idempotent per session.
- [ ] **Step 5: Run → GREEN.** `npx vitest run src/lib/__tests__/storeSnippets.test.ts`; `npx tsc --noEmit` → 0.
- [ ] **Step 6: Commit** `feat(stores): themed _ft_* cart-attribute theme snippet (first-click campaign ids → order note_attributes), generator + docs`

---

## Task 4: Headless (Lovable) `_ft_*` cart attributes (generator + docs)

**Files:**
- Modify: `dashboard-web/src/lib/storeSnippets.ts` (extend `HEADLESS_CLIENT_TEMPLATE` / headless return with the Storefront-API cart-attribute write)
- Modify: `docs/storefront-snippets/first-touch-attribution.md` (Section 2, Part A — add the cart-attribute write)
- Test: `dashboard-web/src/lib/__tests__/storeSnippets.test.ts` (extend)

- [ ] **Step 1: Write failing test:**

```ts
it('headless snippet documents setting _ft_* cart attributes via Storefront API', () => {
  const r = generateStoreSnippet({ storeId: 's', cartPublicToken: 'tok', allowedOrigins: [], isHeadless: true });
  const all = [r.primary, r.secondary, r.note].filter(Boolean).join('\n');
  expect(all).toContain('_ft_utm_id');
  expect(all).toMatch(/cartAttributesUpdate|attributes:/);
  expect(all).not.toMatch(/\bfbq\(|\bgtag\(|\bttq\(|analytics\.track/);
});
```

- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** — extend `HEADLESS_CLIENT_TEMPLATE` with a documented block: parse `localStorage._ft_attr` → set `_ft_*` cart attributes on the Shopify cart via Storefront API `cartAttributesUpdate` (or `cartCreate` `attributes`) at checkout. Keep it as instructional code (the operator adapts to Lovable's SDK), mirroring the existing Part A/B doc style. Token-free (no store token in client).
- [ ] **Step 4: Update the doc** — Section 2 Part A: add the `_ft_*` cart-attribute write with the canonical key list and the Storefront-API example.
- [ ] **Step 5: Run → GREEN;** `npx tsc --noEmit` → 0.
- [ ] **Step 6: Commit** `feat(stores): headless _ft_* cart-attribute passthrough (Lovable Storefront API), generator + docs`

---

## Task 5: CAPI-safe guard + new-store parity guard

**Files:**
- Test: `dashboard-web/src/lib/__tests__/snippetCapiSafety.test.ts` (new)

- [ ] **Step 1: Write the guard test** — import the generator, render BOTH a themed and a headless snippet, read `docs/storefront-snippets/first-touch-attribution.md` from disk, and assert NONE contain pixel/CAPI calls, AND that every generated snippet includes the `_ft_*` cart-attribute write (new-store parity):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateStoreSnippet } from '@/lib/storeSnippets';

const FORBIDDEN = /\bfbq\s*\(|\bgtag\s*\(|\bttq\s*\(|analytics\.track|dataLayer\.push|\/capi\b|conversions_api/i;
const themed = generateStoreSnippet({ storeId: 's', cartPublicToken: 't', allowedOrigins: [], isHeadless: false });
const headless = generateStoreSnippet({ storeId: 's', cartPublicToken: 't', allowedOrigins: [], isHeadless: true });
const blobs = [themed, headless].flatMap(r => [r.primary, r.secondary, r.note].filter(Boolean) as string[]);
const doc = readFileSync(join(process.cwd(), '..', 'docs', 'storefront-snippets', 'first-touch-attribution.md'), 'utf8');

describe('snippets are CAPI-safe (reporting-only) + carry _ft_* (new-store parity)', () => {
  it('no pixel/CAPI calls in any generated snippet', () => {
    for (const b of blobs) expect(FORBIDDEN.test(b)).toBe(false);
  });
  it('no pixel/CAPI calls in the source-of-truth doc', () => {
    expect(FORBIDDEN.test(doc)).toBe(false);
  });
  it('every generated snippet writes _ft_* cart attributes', () => {
    expect(blobs.join('\n')).toContain('_ft_utm_id');
  });
});
```

(If `process.cwd()` isn't `dashboard-web` in the vitest run, adjust the relative path; verify by running the test.)

- [ ] **Step 2: Run → GREEN** (the snippets from Tasks 3-4 already satisfy it). `npx vitest run src/lib/__tests__/snippetCapiSafety.test.ts`
- [ ] **Step 3: Bite-check** — temporarily add `fbq('track','Purchase')` to one template, re-run → RED, revert → GREEN.
- [ ] **Step 4: Commit** `test(stores): CAPI-safe + _ft_* parity guard over generated snippets + the source-of-truth doc`

---

## Task 6: De-dup ROAS / ערך-המרות cards in the campaign drawer

**Files:**
- Modify: `dashboard-web/src/components/campaign-drawer/CampaignDrawerOverview.tsx` (the KPI grid, ~256-288)
- Test: `dashboard-web/src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx` (extend)

- [ ] **Step 1: Write a failing DOM test** asserting ROAS and "ערך המרות" each render EXACTLY once in the overview (use `getAllByText(/^ROAS$/)` length 1; `getAllByText('ערך המרות')` length 1).
- [ ] **Step 2: Run → RED** (currently 2 each).
- [ ] **Step 3: Implement** — in the "KPI grid" block (the SECOND grid, ~256-270) remove the duplicate `<Stat label="ROAS" …>` and `<Stat label="ערך המרות" …>`; make that grid operational-only. Final KPI grid + strip = `הוצאה · המרות · CTR · CPC · CPA` (move CTR/CPC/CPA up or keep the compact strip; ensure a balanced grid — e.g. `grid-cols-2 sm:grid-cols-4` with הוצאה · המרות · CTR · CPC and CPA, or a 5-col operational row). The scorecard (first grid) keeps `ROAS · ערך המרות · אמינות attribution · ציון בריאות`. Update the file's header comment that says "ROAS/value intentionally repeat" to reflect the de-dup.
- [ ] **Step 4: Run → GREEN.** `npm run test:components -- src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx`; design-color + a11y guards stay green.
- [ ] **Step 5: Commit** `fix(campaign-drawer): de-dup ROAS/ערך-המרות cards — scorecard keeps headline, KPI grid is operational-only`

---

## Task 7: Docs + operator deploy guide + full gate

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (changelog + version bump)
- Modify: `docs/ARCHITECTURE.md` (new section: first-touch `_ft_*` cart-attribute passthrough + analyzer fallback)
- Create: `docs/storefront-snippets/2026-06-08-first-touch-deploy.md` (store-by-store: which snippet goes where — themed theme snippet for uzoshop + zolplus; Lovable cart-attribute write for usmile360; the smoke test; the post-deploy coverage re-probe queries from the spec §1)

- [ ] **Step 1: User Manual** — changelog entry (what changed for the operator: per-campaign certainty improves because first-click campaign ids now ride into orders; ads-drawer shows per-ad trust; drawer cards de-duped) + version bump.
- [ ] **Step 2: ARCHITECTURE** — document the `_ft_*` cart-attribute → `note_attributes` → `first_utm_*` path, the analyzer last-wins/first-fills rule, and the CAPI-safe invariant.
- [ ] **Step 3: Deploy guide** — exact paste targets + the smoke test + the re-probe (count `first_utm_id` per store before/after; success = usmile360 0 → >0).
- [ ] **Step 4: Full gate** — `npm test && npm run test:components && npx tsc --noEmit && npm run lint` all green.
- [ ] **Step 5: Commit** `docs(attribution): User Manual + ARCHITECTURE + operator deploy guide (first-touch passthrough)`
- [ ] **Step 6:** Final adversarial review (spec-compliance + zero-regression skeptic: confirm platform-$ classification untouched, last-click never reassigned, no pixel calls) BEFORE the operator-gated push.

---

## Task 8: Shopify `customerJourneySummary` GraphQL reader (capability-gated)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/shopifyCustomerJourney.ts`
- Read first: `dashboard-web/src/lib/fetchers/shopifyBulkFirstOrder.ts` (the existing Admin GraphQL POST pattern: `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, header `X-Shopify-Access-Token`, userErrors handling) — reuse its request shape.
- Test: `dashboard-web/src/lib/fetchers/__tests__/shopifyCustomerJourney.test.ts` (new)

**What:** A reader that, given a store domain + token + a list of order GIDs (or a date filter), runs an Admin GraphQL query for `customerJourneySummary` and returns `Map<orderId, { first: VisitUtm; last: VisitUtm }>` where `VisitUtm = { landingPage, source, utmSource, utmMedium, utmCampaign, utmContent, utmTerm }`. Parse `utm_id` out of `landingPage` (Shopify's `UTMParameters` type has source/medium/campaign/content/term but NOT id, so `utm_id` must come from the landing URL query). **Capability-gated:** Protected Customer Data is required — on a GraphQL error whose code/message indicates access denied (e.g. `ACCESS_DENIED`, `not approved to access`, `Protected customer data`), return an empty map AND a `{ unavailable: true }` flag; never throw, never regress. Gated behind env `ENABLE_SHOPIFY_CUSTOMER_JOURNEY` (default off).

GraphQL document (API 2026-04):
```graphql
query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      customerJourneySummary {
        firstVisit { landingPage source utmParameters { source medium campaign content term } }
        lastVisit  { landingPage source utmParameters { source medium campaign content term } }
      }
    }
  }
}
```

- [ ] **Step 1: Failing tests** — mock `fetch`:
  - returns parsed first/last UTM for an order whose `firstVisit.landingPage` is `/p?utm_id=c1&utm_campaign=Sale` → `first.utmCampaign === 'Sale'` AND parsed `utm_id` (expose it as `first.utmId === 'c1'`).
  - a GraphQL response with `errors: [{ extensions: { code: 'ACCESS_DENIED' } }]` (or message containing "Protected customer data") → returns `{ map: empty, unavailable: true }`, no throw.
  - `ENABLE_SHOPIFY_CUSTOMER_JOURNEY` unset → the reader returns empty + `disabled: true` without making a request.
- [ ] **Step 2: Run → RED.** `npx vitest run src/lib/fetchers/__tests__/shopifyCustomerJourney.test.ts`
- [ ] **Step 3: Implement** the reader (reuse `shopifyBulkFirstOrder.ts`'s POST pattern + `SHOPIFY_API_VERSION`). Parse `utm_id` from `landingPage` via `URLSearchParams(new URL(landingPage, 'https://x').search)`. Batch GIDs (≤250 per `nodes` call). Capability detection as above.
- [ ] **Step 4: Run → GREEN;** `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `feat(attribution): Shopify customerJourneySummary GraphQL reader (capability-gated, flag-off default)`

## Task 9: Merge customerJourney UTM into orders_attribution (gap-fill only)

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/shopify.ts` (the order-build path, after `classifyOrderAttribution(o)` ~952) — when the flag is on AND the reader returned data, FILL missing first-touch fields from the journey.
- Test: `dashboard-web/src/lib/__tests__/shopifyCustomerJourneyMerge.test.ts` (new)

**Rule (zero-regression, last-wins):** only FILL a field that is currently empty/null. Journey's `firstVisit` → `firstUtm*` (and `firstUtmId` from the parsed landing `utm_id`); journey's `lastVisit` → last-touch `utm*` ONLY when the order's REST `utm*` is empty. NEVER overwrite a present value; NEVER change `source` (platform-$ classification stays). When the flag is off or the reader is unavailable, the merge is a no-op → byte-identical to today.

- [ ] **Step 1: Failing test** — an order with empty `utmId`/`firstUtmId` + a journey map entry `{ first: { utmId: 'c1', utmCampaign: 'Sale' } }` → after merge, `firstUtmId === 'c1'`. An order whose `utmId` is already `'c9'` + journey `first.utmId==='c1'` → `utmId` stays `'c9'` (no overwrite), `firstUtmId` filled from journey. Flag off → no change.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** — extract a pure helper `mergeCustomerJourney(row, journeyEntry): OrderAttributionRow` (new small exported fn, easy to unit-test) and call it in `shopify.ts` after classification when the flag/data are present. The GraphQL fetch itself is wired into the order-sync flow (one `nodes` batch per page of orders).
- [ ] **Step 4: Run → GREEN;** `npx tsc --noEmit` → 0; full attribution suite green.
- [ ] **Step 5: Commit** `feat(attribution): gap-fill orders_attribution first-touch UTM from Shopify customerJourneySummary (flag-gated, never overwrites)`

> **Operator dependency (Task 7 deploy guide must document):** `customerJourneySummary` needs Shopify **Protected Customer Data** approval per custom app (request data-protection access + the "Customer data" use in each app's API access page; analogous to the prior `read_customers` grant). Until approved the reader self-detects ACCESS_DENIED and stays a no-op. Flip `ENABLE_SHOPIFY_CUSTOMER_JOURNEY=1` once approved.

---

## Self-review
- **Spec coverage:** Layer 1 (Tasks 3+4 snippets + generator + docs) · Layer 2 (Tasks 1+2 analyzer fallback + ad-level) · Layer 4 de-dup (Task 6) · CAPI-safe + parity guards (Task 5) · zero-regression (Task 1 last-wins tests + Task 7 review) · docs + deploy (Task 7). Layer 3 explicitly deferred to a Phase-2 plan (spec §6).
- **Type consistency:** uses the real `OrderAttributionRow` fields (`firstUtmId/Campaign/Term/Content`) and the real matcher signatures; cart-attribute keys (`_ft_utm_id` …) match `classifyOrderSource`'s `ft_*` lookups.
- **No placeholders:** every code step shows the actual code; commands are exact.
- **CAPI-safety** is both a design invariant AND an enforced test (Task 5) over generated snippets + the doc.
