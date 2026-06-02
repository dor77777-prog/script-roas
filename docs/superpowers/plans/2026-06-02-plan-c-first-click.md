# Plan C — First-click lens (Phase 4, GATED)

## Goal

Add **one** additional attribution lens — **first-click** — beside the existing last-click "ROAS Shopify" deterministic numbers, so the operator can see how much of a campaign's credit comes from being the *introducer* of a customer vs. the *closer*. The lens is read entirely from data we already hold (Shopify `note_attributes` folded into the same params bag the last-click classifier reads), persisted into additive `first_*` columns on `orders_attribution`, analyzed by a sibling first-click analyzer, and rendered side-by-side with last-click in `CampaignsTable` + `AdsDrawer` — headlining the **delta** on hover at ~60-70% prominence vs. MER. The store-side capture (cookie + cart-attribute write) ships as **documented operator install steps**, never as code, with a CAPI-safety gate.

This is **Phase 4** of the 2026-06-02 dashboard-improvements design (`docs/superpowers/specs/2026-06-02-dashboard-improvements-design.md`). It is **GATED**: it starts only after Plans A (Phase 0–2) and B (Phase 3) have shipped and soaked. Do not begin Task 1 until the operator confirms the gate is open.

## Architecture

- **In-repo, CI-covered (safe — ships first):** `classifyOrderAttribution` (`src/lib/fetchers/shopify.ts`) already folds `note_attributes` into a single `params` bag. We extend it to *also* read `ft_*`-namespaced keys from that **same bag** (no Shopify fetch-field-allowlist change) and run a **trimmed** source chain over **only** the `ft_*` keys (NOT `source_name` / `referring_site`), emitting `first_touch_source` + `first_*_present` + `first_utm_*` + `first_seen_at`. The trimmed chain reuses the existing `OrderSource` union so `orderSourceContract.test` stays green.
- **Storage (additive):** new nullable `first_*` columns on `orders_attribution`. **Pre-migration rows = "no first-click signal"** (NULL), explicitly *not* `'direct'`. Both cron maps (`cronDaily`, `cronLive`) dual-write the new columns; `postgresReaders` + `OrderAttributionRow` read them back.
- **Analyzer (sibling, no model toggle):** new `analyzeFirstClickForCampaign` / `analyzeFirstClickForAd` in `src/lib/attributionAnalysis.ts`, parallel to `orderMatchesCampaign` / `analyzeAttributionForAd`. Matching: `firstUtmId`/`firstUtmCampaign` at campaign grain; `firstUtmContent === adId` at ad grain. Credit is assigned to the store via the **existing** `campaignStoreMap` (incl. the TikTok shared-account `uzoshop`-default override) — never raw account totals. **First-click is GOOGLE-BLIND** (the matcher excludes Google, same as last-click) — surfaced in the tooltip.
- **UI:** first-click value rendered beside last-click "ROAS Shopify" in `CampaignsTable` + `AdsDrawer`; the **delta** is headlined on hover (progressive disclosure). A separate **first-click coverage chip**. All numbers go through `<Money>`/`<Metric>` + on-band/scrim tokens (2026-06-01 readability standard).
- **Store-side capture (outside repo — docs only):** `uzoshop` + `zolplus` FIRST (Custom Pixel + theme-JS: first-party cookie write-once on landing → `/cart/update.js {_ft_*}` on add-to-cart, **single** underscore, zero `fbq/gtag/ttq`); `usmile` (Lovable headless) LAST via the existing `/api/events/cart` beacon keyed by cart/checkout token, JOIN at read time. A CAPI-safety checklist gates trusting the numbers.

### Naming map (single source of truth — every task uses these exact names)

| Concept | `ft_*` cart key (Shopify) | `note_attributes` name | DB column | `OrderAttributionRow` field | `ShopifyOrderRow` field |
|---|---|---|---|---|---|
| First fbclid present | `ft_fbclid` | `ft_fbclid` | `first_fbclid_present` (bool) | `firstFbclidPresent` | `firstFbclidPresent` |
| First gclid present | `ft_gclid` | `ft_gclid` | `first_gclid_present` (bool) | `firstGclidPresent` | `firstGclidPresent` |
| First ttclid present | `ft_ttclid` | `ft_ttclid` | `first_ttclid_present` (bool) | `firstTtclidPresent` | `firstTtclidPresent` |
| First utm_source | `ft_utm_source` | `ft_utm_source` | `first_utm_source` (text) | `firstUtmSource` | `firstUtmSource` |
| First utm_medium | `ft_utm_medium` | `ft_utm_medium` | `first_utm_medium` (text) | `firstUtmMedium` | `firstUtmMedium` |
| First utm_campaign | `ft_utm_campaign` | `ft_utm_campaign` | `first_utm_campaign` (text) | `firstUtmCampaign` | `firstUtmCampaign` |
| First utm_content | `ft_utm_content` | `ft_utm_content` | `first_utm_content` (text) | `firstUtmContent` | `firstUtmContent` |
| First utm_id | `ft_utm_id` | `ft_utm_id` | `first_utm_id` (text) | `firstUtmId` | `firstUtmId` |
| First utm_term | `ft_utm_term` | `ft_utm_term` | `first_utm_term` (text) | `firstUtmTerm` | `firstUtmTerm` |
| First touch classified source | (derived) | (derived) | `first_touch_source` (text) | `firstTouchSource` | `firstTouchSource` |
| First-touch timestamp | `ft_set_at` | `ft_set_at` | `first_seen_at` (text/ISO) | `firstSeenAt` | `firstSeenAt` |

**Store-side cart key = single underscore `_ft_*`** (what the theme/pixel writes via `/cart/update.js`). Shopify surfaces cart attributes prefixed `_` as private; they arrive in the order's `note_attributes` with the **same** name. The classifier reads the `note_attributes` name verbatim (it lowercases keys), so it looks for `_ft_*`. To keep one canonical token in code, the classifier normalizes a leading `_` off `_ft_` → `ft_` before lookup (handled in Task 1). All DB/field/code names use the **`ft_`/`first_`** forms above; only the storefront write uses `_ft_`.

## Tech Stack

- **Language/runtime:** TypeScript, Node (Inngest functions + Next.js App Router), React 18 client components.
- **DB:** Supabase Postgres. Additive SQL migration under `dashboard-web/supabase/migrations/`.
- **Tests:**
  - Node (pure) tests: `npx vitest run <path>` — config `vitest.config.ts`; env `node`; globs `src/lib|inngest|components|app/**/__tests__/**/*.test.{ts,tsx}` EXCLUDING `*.dom.test.*`.
  - DOM/component tests: `npx vitest run --config vitest.config.dom.ts <path>` — jsdom + `@testing-library/jest-dom`; file glob `*.dom.test.{ts,tsx}` under `src/components/**/__tests__` or `src/lib/**/__tests__`.
  - Type-check: `npx tsc --noEmit`.
  - Test files import `{ describe, it, expect, vi }` from `'vitest'` (globals:false).
  - **cwd for ALL commands = `/Users/dorperetz/script-roas/dashboard-web`.**
- **UI primitives:** `<Money>` (`src/components/ui/Money.tsx`), `<Metric>`, on-band/scrim tokens, `lucide-react` icons.
- **Commits:** conventional commits; body ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit to `main` directly. **PUSH is a separate explicit step — do NOT push in any task.**

## For agentic workers

Execute with **superpowers:subagent-driven-development**. Each task below is a self-contained TDD unit: write a failing test with REAL code, run it to confirm the expected failure, write the minimal REAL implementation, run to confirm PASS, then commit. Check off each `[ ]` step as you complete it. Do NOT batch tasks. Do NOT push.

- [ ] Confirm the GATE is open (Plans A + B shipped and soaked) before starting Task 1.

---

## Files touched (map)

**Create:**
- `dashboard-web/src/lib/__tests__/classifyFirstClick.test.ts` (Task 1 test)
- `dashboard-web/supabase/migrations/20260603090000_add_first_click_columns_to_orders_attribution.sql` (Task 2)
- `dashboard-web/src/lib/__tests__/firstClickColumnsDualWrite.test.ts` (Task 3 test)
- `dashboard-web/src/lib/__tests__/postgresReadersFirstClick.test.ts` (Task 4 test)
- `dashboard-web/src/lib/__tests__/analyzeFirstClick.test.ts` (Task 5 test)
- `dashboard-web/src/lib/__tests__/firstClickStoreCredit.test.ts` (Task 6 test)
- `dashboard-web/src/components/firstClickDelta.ts` (Task 7 impl — pure helper)
- `dashboard-web/src/components/__tests__/firstClickDelta.test.ts` (Task 7 test — node)
- `dashboard-web/src/components/FirstClickCoverageChip.tsx` (Task 8 impl)
- `dashboard-web/src/components/__tests__/FirstClickCoverageChip.dom.test.tsx` (Task 8 test — DOM)
- `dashboard-web/src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx` (Task 9 test — DOM)

**Modify:**
- `dashboard-web/src/lib/fetchers/shopify.ts` — `classifyOrderAttribution` (~:818-943) + `ShopifyOrderRow` type (:209-225) + `fetchShopifyOrdersAttribution` row push (:1060-1076) + `fields` allowlist comment note (:1019). (Tasks 1, 3)
- `dashboard-web/src/lib/ordersAttribution.ts` — extend `OrderAttributionRow` (:30-58). (Task 4)
- `dashboard-web/src/lib/postgresReaders.ts` — `fetchOrdersAttributionFromPostgres` SELECT + row map (:1051-1094). (Task 4)
- `dashboard-web/src/inngest/functions/cronDaily.ts` — orders_attribution upsert map (:1419-1435). (Task 3)
- `dashboard-web/src/inngest/functions/cronLive.ts` — orders_attribution upsert map (:682-698). (Task 3)
- `dashboard-web/src/lib/attributionAnalysis.ts` — add sibling first-click analyzers near `analyzeAttributionForAd` (:834-886). (Tasks 5, 6)
- `dashboard-web/src/lib/__tests__/fixtures.ts` — extend `makeOrder` defaults with first-click fields (:17-37). (Task 5)
- `dashboard-web/src/components/CampaignsTable.tsx` — render first-click value + delta + coverage chip beside ROAS Shopify (~:1924-1995 header region + matching body cell). (Task 9)
- `dashboard-web/src/components/AdsDrawer.tsx` — render first-click value + delta beside ROAS Shopify (:512-623). (Task 10)
- `docs/ROAS-Dashboard-User-Manual.md` — operator install steps + CAPI-safety checklist (Task 11).

**Untouched (regression guards must stay green):** per-store Home cards + ROAS-band gradients; `campaignStoreMap*.test`, `tiktokFetcherStoreMapping.test`, `productCentricViewSumConservation.test`, `cannibalizationDetection.test`, `campaignProductMap.test`, `campaignsAggregator.test`, `orderSourceContract.test`.

---

## Task 1 — `classifyOrderAttribution` reads `ft_*` keys → first-click fields

Extend the existing classifier to additionally emit first-click fields from the SAME params bag (already folded from `note_attributes`), via a TRIMMED chain over ONLY `ft_*` keys (no `source_name`, no `referring_site`).

**Files**
- Modify: `src/lib/fetchers/shopify.ts` — `classifyOrderAttribution` return type + body (:818-943); `ShopifyOrderRow` (:209-225); `fetchShopifyOrdersAttribution` push block (:1060-1076).
- Test: `src/lib/__tests__/classifyFirstClick.test.ts` (Create).

`classifyOrderAttribution` is not currently exported. Export it so the test can call it directly (add `export` to the `function classifyOrderAttribution` declaration).

- [ ] **Write the failing test** — `src/lib/__tests__/classifyFirstClick.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyOrderAttribution } from '@/lib/fetchers/shopify';

/**
 * First-click (Phase 4) extension of classifyOrderAttribution. The classifier
 * already folds note_attributes into the params bag; we additionally read the
 * ft_*-namespaced keys (single underscore _ft_ on the storefront is normalized
 * to ft_) and run a TRIMMED source chain over ONLY those keys — never
 * source_name / referring_site.
 */
describe('classifyOrderAttribution — first-click (ft_*) extension', () => {
  it('emits null/false first-click fields when no ft_* keys are present', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/?utm_source=facebook&utm_medium=cpc&fbclid=ABC',
      note_attributes: [],
    });
    // Last-click still works.
    expect(c.source).toBe('meta-paid');
    // First-click absent → "no first-click signal", NOT 'direct'.
    expect(c.firstTouchSource).toBeNull();
    expect(c.firstFbclidPresent).toBe(false);
    expect(c.firstGclidPresent).toBe(false);
    expect(c.firstTtclidPresent).toBe(false);
    expect(c.firstUtmSource).toBeNull();
    expect(c.firstUtmCampaign).toBeNull();
    expect(c.firstUtmContent).toBeNull();
    expect(c.firstUtmId).toBeNull();
    expect(c.firstUtmTerm).toBeNull();
    expect(c.firstSeenAt).toBeNull();
  });

  it('reads ft_* from note_attributes (single-underscore _ft_ normalized to ft_)', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/?gclid=LAST',
      note_attributes: [
        { name: '_ft_fbclid', value: 'FBFIRST' },
        { name: '_ft_utm_source', value: 'facebook' },
        { name: '_ft_utm_medium', value: 'cpc' },
        { name: '_ft_utm_campaign', value: 'Intro Campaign' },
        { name: '_ft_utm_id', value: 'camp-first-1' },
        { name: '_ft_utm_content', value: 'ad-first-1' },
        { name: '_ft_utm_term', value: 'adset-first-1' },
        { name: '_ft_set_at', value: '2026-06-01T10:00:00.000Z' },
      ],
    });
    // Last-click is gclid → google-paid (unchanged).
    expect(c.source).toBe('google-paid');
    // First-click is the introducer = Meta.
    expect(c.firstTouchSource).toBe('meta-paid');
    expect(c.firstFbclidPresent).toBe(true);
    expect(c.firstGclidPresent).toBe(false);
    expect(c.firstUtmSource).toBe('facebook');
    expect(c.firstUtmCampaign).toBe('Intro Campaign');
    expect(c.firstUtmId).toBe('camp-first-1');
    expect(c.firstUtmContent).toBe('ad-first-1');
    expect(c.firstUtmTerm).toBe('adset-first-1');
    expect(c.firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('first-click chain is TRIMMED: ignores source_name and referring_site', () => {
    // source_name=tiktok and an fb referrer would change LAST-click, but the
    // first-click chain must NOT consult them — only ft_* keys.
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      referring_site: 'https://facebook.com/',
      source_name: 'tiktok',
      note_attributes: [
        { name: 'ft_ttclid', value: 'TTFIRST' },
      ],
    });
    // First-click resolves from ft_ttclid alone → tiktok-paid.
    expect(c.firstTouchSource).toBe('tiktok-paid');
    expect(c.firstTtclidPresent).toBe(true);
    // No ft_utm_* present.
    expect(c.firstUtmSource).toBeNull();
  });

  it('first-click utm chain mirrors last-click cpc/source classification', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      note_attributes: [
        { name: 'ft_utm_source', value: 'tiktok' },
        { name: 'ft_utm_medium', value: 'paidsocial' },
      ],
    });
    expect(c.firstTouchSource).toBe('tiktok-paid');
  });

  it('ft_* keys with only utm_source (no medium, no clid) → other-paid', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      note_attributes: [{ name: 'ft_utm_source', value: 'influencer-x' }],
    });
    expect(c.firstTouchSource).toBe('other-paid');
  });
});
```

- [ ] **Run (expect FAIL)** — `npx vitest run src/lib/__tests__/classifyFirstClick.test.ts`
  Expected: FAIL — `classifyOrderAttribution` is not exported / does not return `firstTouchSource` etc.

- [ ] **Minimal impl** — in `src/lib/fetchers/shopify.ts`:

  1. Export the classifier: change `function classifyOrderAttribution(` (:818) to `export function classifyOrderAttribution(`.

  2. Extend its return type (replace the existing return-type object at :818-829) with the first-click fields:

```ts
export function classifyOrderAttribution(order: ShopifyOrderPayload): {
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmId: string;
  utmTerm: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string;
  // Phase 4 — first-click lens. Null/false when no ft_* signal is present
  // ("no first-click signal", NOT 'direct').
  firstTouchSource: string | null;
  firstFbclidPresent: boolean;
  firstGclidPresent: boolean;
  firstTtclidPresent: boolean;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmId: string | null;
  firstUtmTerm: string | null;
  firstSeenAt: string | null;
} {
```

  3. After the existing `params` bag is fully populated (i.e. after the `note_attributes` fold loop ends at :854, before `const utmSource = params['utm_source'] ?? '';` at :856), add a first-click bag + the trimmed chain. Insert this block:

```ts
  // ---- Phase 4: first-click (ft_*) bag + TRIMMED source chain ----
  // The storefront writes cart attributes as `_ft_*` (single leading
  // underscore = Shopify-private), which surface in note_attributes with
  // the same name. Normalize a leading `_` off `_ft_` so the canonical
  // lookup key is `ft_*`. We read ONLY from `params` (already folded from
  // landing_site + note_attributes) — no extra fetch, no new field.
  const ftBag: Record<string, string> = Object.create(null);
  for (const k of Object.keys(params)) {
    const norm = k.startsWith('_ft_') ? k.slice(1) : k; // _ft_x -> ft_x
    if (norm.startsWith('ft_')) ftBag[norm] = params[k];
  }
  const ftGet = (suffix: string): string => ftBag[`ft_${suffix}`] ?? '';

  const firstFbclid = !!ftGet('fbclid');
  const firstGclid = !!ftGet('gclid');
  const firstTtclid = !!ftGet('ttclid');
  const firstUtmSourceRaw = ftGet('utm_source');
  const firstUtmMediumRaw = ftGet('utm_medium');
  const firstUtmCampaignRaw = ftGet('utm_campaign');
  const firstUtmContentRaw = ftGet('utm_content');
  const firstUtmIdRaw = ftGet('utm_id');
  const firstUtmTermRaw = ftGet('utm_term');
  const firstSeenAtRaw = ftGet('set_at');

  const hasFirstSignal =
    firstFbclid || firstGclid || firstTtclid ||
    !!firstUtmSourceRaw || !!firstUtmCampaignRaw || !!firstUtmContentRaw ||
    !!firstUtmIdRaw || !!firstUtmTermRaw || !!firstSeenAtRaw;

  // TRIMMED chain over ONLY ft_* keys — NO source_name, NO referring_site.
  let firstTouchSource: string | null = null;
  if (hasFirstSignal) {
    if (firstFbclid) firstTouchSource = 'meta-paid';
    else if (firstGclid) firstTouchSource = 'google-paid';
    else if (firstTtclid) firstTouchSource = 'tiktok-paid';
    else if (/cpc|paid|paidsocial|social/i.test(firstUtmMediumRaw)) {
      if (/^(facebook|fb|meta|instagram|ig)$/i.test(firstUtmSourceRaw)) firstTouchSource = 'meta-paid';
      else if (/^(google|youtube)$/i.test(firstUtmSourceRaw)) firstTouchSource = 'google-paid';
      else if (/^tiktok$/i.test(firstUtmSourceRaw)) firstTouchSource = 'tiktok-paid';
      else firstTouchSource = 'other-paid';
    } else if (/^(email|newsletter|klaviyo|mailchimp)$/i.test(firstUtmSourceRaw)) {
      firstTouchSource = 'email';
    } else if (/^tiktok$/i.test(firstUtmSourceRaw)) {
      firstTouchSource = 'tiktok-paid';
    } else if (firstUtmSourceRaw) {
      firstTouchSource = 'other-paid';
    } else {
      // Has a ft_* signal (e.g. only ft_set_at / only a clid we didn't map)
      // but no classifiable source — leave as null so it reads as
      // "no first-click signal" rather than a fabricated bucket.
      firstTouchSource = null;
    }
  }
```

  4. In the `return {` object (:931-942), append the first-click fields (keep the existing fields unchanged):

```ts
    firstTouchSource,
    firstFbclidPresent: firstFbclid,
    firstGclidPresent: firstGclid,
    firstTtclidPresent: firstTtclid,
    firstUtmSource: firstUtmSourceRaw || null,
    firstUtmMedium: firstUtmMediumRaw || null,
    firstUtmCampaign: firstUtmCampaignRaw || null,
    firstUtmContent: firstUtmContentRaw || null,
    firstUtmId: firstUtmIdRaw || null,
    firstUtmTerm: firstUtmTermRaw || null,
    firstSeenAt: firstSeenAtRaw || null,
```

  5. Extend the `ShopifyOrderRow` type (:209-225) with the first-click fields:

```ts
  utmId: string | null;
  utmTerm: string | null;
  lineItems: Array<{ p: string; u: number; r: number }> | null;
  // Phase 4 — first-click lens. Null when no ft_* signal on the order.
  firstTouchSource: string | null;
  firstFbclidPresent: boolean;
  firstGclidPresent: boolean;
  firstTtclidPresent: boolean;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmId: string | null;
  firstUtmTerm: string | null;
  firstSeenAt: string | null;
```

  6. In `fetchShopifyOrdersAttribution`'s `out.push({...})` (:1060-1076), append the first-click fields after `lineItems: computeLineItemsCad(o, totalCad),`:

```ts
        lineItems: computeLineItemsCad(o, totalCad),
        firstTouchSource: classified.firstTouchSource,
        firstFbclidPresent: classified.firstFbclidPresent,
        firstGclidPresent: classified.firstGclidPresent,
        firstTtclidPresent: classified.firstTtclidPresent,
        firstUtmSource: classified.firstUtmSource,
        firstUtmMedium: classified.firstUtmMedium,
        firstUtmCampaign: classified.firstUtmCampaign,
        firstUtmContent: classified.firstUtmContent,
        firstUtmId: classified.firstUtmId,
        firstUtmTerm: classified.firstUtmTerm,
        firstSeenAt: classified.firstSeenAt,
```

  7. Update the `fields` allowlist comment at :1019 to note NO new field is added (the `ft_*` arrive inside `note_attributes`, which is already in the list). Leave the literal `fields` string unchanged. Replace the line `  const fields =` with a preceding comment:

```ts
  // Phase 4 note: first-click ft_* keys arrive inside `note_attributes`
  // (already in this allowlist) — NO new Shopify field is requested.
  const fields =
```

- [ ] **Run (expect PASS)** — `npx vitest run src/lib/__tests__/classifyFirstClick.test.ts`
- [ ] **Type-check** — `npx tsc --noEmit` (expect: clean — the new `ShopifyOrderRow` fields are populated only in `fetchShopifyOrdersAttribution`; the cron upsert maps don't reference them yet, which is fine since they spread `o`).
- [ ] **Commit:**
```
git add src/lib/fetchers/shopify.ts src/lib/__tests__/classifyFirstClick.test.ts
git commit -m "$(cat <<'EOF'
feat(attribution): classifyOrderAttribution reads ft_* first-click keys

Extend the existing classifier (which already folds note_attributes into
the params bag) to additionally emit first-click fields via a TRIMMED chain
over ONLY ft_* keys (single-underscore _ft_ normalized to ft_) — never
source_name / referring_site. No Shopify fetch-field-allowlist change. NULL
first-click = "no first-click signal", explicitly not 'direct'.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Additive migration: `first_*` columns on `orders_attribution`

**Files**
- Create: `supabase/migrations/20260603090000_add_first_click_columns_to_orders_attribution.sql`.
- Test: none (DDL-only; the dual-write/read contract is exercised in Tasks 3 + 4). This task's verification is the file content + a no-op type-check.

- [ ] **Write the migration** — `supabase/migrations/20260603090000_add_first_click_columns_to_orders_attribution.sql`:

```sql
-- Phase 4 (first-click lens) — additive, nullable columns on orders_attribution.
-- Pre-migration rows keep NULL = "no first-click signal" (NOT 'direct').
-- READ-ONLY toward ad platforms: these are populated only from Shopify cart
-- attributes (ft_*) folded into the order's note_attributes; nothing is ever
-- sent to any pixel/CAPI.

ALTER TABLE orders_attribution
  ADD COLUMN IF NOT EXISTS first_touch_source    text,
  ADD COLUMN IF NOT EXISTS first_fbclid_present   boolean,
  ADD COLUMN IF NOT EXISTS first_gclid_present    boolean,
  ADD COLUMN IF NOT EXISTS first_ttclid_present   boolean,
  ADD COLUMN IF NOT EXISTS first_utm_source       text,
  ADD COLUMN IF NOT EXISTS first_utm_medium       text,
  ADD COLUMN IF NOT EXISTS first_utm_campaign     text,
  ADD COLUMN IF NOT EXISTS first_utm_content      text,
  ADD COLUMN IF NOT EXISTS first_utm_id           text,
  ADD COLUMN IF NOT EXISTS first_utm_term         text,
  ADD COLUMN IF NOT EXISTS first_seen_at          text;

COMMENT ON COLUMN orders_attribution.first_touch_source IS
  'Phase 4 first-click lens: classified source of the customer''s FIRST touch (ft_* cart attributes). NULL = no first-click signal captured (NOT direct).';
```

- [ ] **Verify file is well-formed** — `npx tsc --noEmit` (expect: clean — no TS change yet; this confirms the repo still type-checks).
- [ ] **Note for the operator (do NOT apply in this task):** Applying the migration to prod is an operator action via the established Supabase migration flow. The plan does NOT run `supabase db push`. Per project memory, additive `first_*` columns on `orders_attribution` ARE intended for this phase (unlike the COGS work, which was deliberately client-side).
- [ ] **Commit:**
```
git add supabase/migrations/20260603090000_add_first_click_columns_to_orders_attribution.sql
git commit -m "$(cat <<'EOF'
feat(db): additive first_* columns on orders_attribution (first-click lens)

Nullable columns; pre-migration rows = NULL = "no first-click signal"
(NOT 'direct'). Populated only from Shopify cart attributes — read-only
toward ad platforms.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Dual-write `first_*` columns in BOTH cron maps

**Files**
- Modify: `src/inngest/functions/cronDaily.ts` (orders_attribution upsert map, :1419-1435).
- Modify: `src/inngest/functions/cronLive.ts` (orders_attribution upsert map, :682-698).
- Test: `src/lib/__tests__/firstClickColumnsDualWrite.test.ts` (Create).

The dual-write is identical in both maps. Rather than reach into Inngest internals, the test asserts the **mapping function** is exported and produces every `first_*` key from a `ShopifyOrderRow`. Add a small exported pure helper that both cron maps call, so the two writers can never drift.

- [ ] **Write the failing test** — `src/lib/__tests__/firstClickColumnsDualWrite.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toOrdersAttributionRow } from '@/lib/fetchers/shopify';
import type { ShopifyOrderRow } from '@/lib/fetchers/shopify';

/**
 * Dual-write guard: BOTH cron maps (cronDaily + cronLive) persist
 * orders_attribution via toOrdersAttributionRow. This pins the exact DB
 * column key-set so the two writers can never drift (Phase-0 risk).
 */
function makeRow(overrides: Partial<ShopifyOrderRow> = {}): ShopifyOrderRow {
  return {
    storeId: 'uzoshop',
    orderId: 'o-1',
    date: '2026-06-02',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'Closer',
    utmContent: 'ad-1',
    fbclidPresent: true,
    gclidPresent: false,
    referrer: '',
    utmId: 'camp-1',
    utmTerm: 'adset-1',
    lineItems: [{ p: 'p-1', u: 1, r: 100 }],
    firstTouchSource: 'meta-paid',
    firstFbclidPresent: true,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: 'facebook',
    firstUtmMedium: 'cpc',
    firstUtmCampaign: 'Intro',
    firstUtmContent: 'ad-first-1',
    firstUtmId: 'camp-first-1',
    firstUtmTerm: 'adset-first-1',
    firstSeenAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('toOrdersAttributionRow — first-click dual-write key-set', () => {
  it('maps every first_* column from the ShopifyOrderRow', () => {
    const db = toOrdersAttributionRow(makeRow());
    expect(db.first_touch_source).toBe('meta-paid');
    expect(db.first_fbclid_present).toBe(true);
    expect(db.first_gclid_present).toBe(false);
    expect(db.first_ttclid_present).toBe(false);
    expect(db.first_utm_source).toBe('facebook');
    expect(db.first_utm_medium).toBe('cpc');
    expect(db.first_utm_campaign).toBe('Intro');
    expect(db.first_utm_content).toBe('ad-first-1');
    expect(db.first_utm_id).toBe('camp-first-1');
    expect(db.first_utm_term).toBe('adset-first-1');
    expect(db.first_seen_at).toBe('2026-06-01T10:00:00.000Z');
  });

  it('still maps the existing last-click columns (no regression)', () => {
    const db = toOrdersAttributionRow(makeRow());
    expect(db.store_id).toBe('uzoshop');
    expect(db.order_id).toBe('o-1');
    expect(db.source).toBe('meta-paid');
    expect(db.fbclid_present).toBe(true);
    expect(db.utm_id).toBe('camp-1');
    expect(db.line_items).toEqual([{ p: 'p-1', u: 1, r: 100 }]);
  });

  it('passes NULL first-click through unchanged (no first-click signal)', () => {
    const db = toOrdersAttributionRow(makeRow({
      firstTouchSource: null,
      firstFbclidPresent: false,
      firstGclidPresent: false,
      firstTtclidPresent: false,
      firstUtmSource: null,
      firstUtmMedium: null,
      firstUtmCampaign: null,
      firstUtmContent: null,
      firstUtmId: null,
      firstUtmTerm: null,
      firstSeenAt: null,
    }));
    expect(db.first_touch_source).toBeNull();
    expect(db.first_utm_id).toBeNull();
    expect(db.first_seen_at).toBeNull();
  });
});
```

- [ ] **Run (expect FAIL)** — `npx vitest run src/lib/__tests__/firstClickColumnsDualWrite.test.ts`
  Expected: FAIL — `toOrdersAttributionRow` is not exported from `@/lib/fetchers/shopify`.

- [ ] **Minimal impl:**

  1. In `src/lib/fetchers/shopify.ts`, after the `fetchShopifyOrdersAttribution` function (after :1092), add the shared mapper:

```ts
/**
 * Phase 4 — single source of truth for the orders_attribution DB row shape.
 * Both cron maps (cronDaily + cronLive) call this so the dual-write key-set
 * can never drift. Includes the additive first_* (first-click lens) columns.
 */
export function toOrdersAttributionRow(o: ShopifyOrderRow): {
  store_id: string;
  order_id: string;
  date: string;
  total_cad: number;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbclid_present: boolean;
  gclid_present: boolean;
  referrer: string | null;
  utm_id: string | null;
  utm_term: string | null;
  line_items: Array<{ p: string; u: number; r: number }> | null;
  first_touch_source: string | null;
  first_fbclid_present: boolean;
  first_gclid_present: boolean;
  first_ttclid_present: boolean;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_utm_content: string | null;
  first_utm_id: string | null;
  first_utm_term: string | null;
  first_seen_at: string | null;
} {
  return {
    store_id: o.storeId,
    order_id: o.orderId,
    date: o.date,
    total_cad: o.totalCad,
    source: o.source,
    utm_source: o.utmSource,
    utm_medium: o.utmMedium,
    utm_campaign: o.utmCampaign,
    utm_content: o.utmContent,
    fbclid_present: o.fbclidPresent,
    gclid_present: o.gclidPresent,
    referrer: o.referrer,
    utm_id: o.utmId,
    utm_term: o.utmTerm,
    line_items: o.lineItems,
    first_touch_source: o.firstTouchSource,
    first_fbclid_present: o.firstFbclidPresent,
    first_gclid_present: o.firstGclidPresent,
    first_ttclid_present: o.firstTtclidPresent,
    first_utm_source: o.firstUtmSource,
    first_utm_medium: o.firstUtmMedium,
    first_utm_campaign: o.firstUtmCampaign,
    first_utm_content: o.firstUtmContent,
    first_utm_id: o.firstUtmId,
    first_utm_term: o.firstUtmTerm,
    first_seen_at: o.firstSeenAt,
  };
}
```

  2. In `src/inngest/functions/cronDaily.ts`, import the mapper. At the existing import line `  fetchShopifyOrdersAttribution,` (:45), add on the next line within the same import braces:

```ts
  fetchShopifyOrdersAttribution,
  toOrdersAttributionRow,
```

  Then replace the `orderRows` map (:1419-1435) with:

```ts
      const orderRows = shopify.orders.map(toOrdersAttributionRow);
```

  3. In `src/inngest/functions/cronLive.ts`, at the import line `  fetchShopifyOrdersAttribution,` (:94), add on the next line within the same import braces:

```ts
  fetchShopifyOrdersAttribution,
  toOrdersAttributionRow,
```

  Then replace the `orderRows` map (:682-698) with:

```ts
      const orderRows = todayOrders.map(toOrdersAttributionRow);
```

- [ ] **Run (expect PASS)** — `npx vitest run src/lib/__tests__/firstClickColumnsDualWrite.test.ts`
- [ ] **Run cron regression** — `npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts src/inngest/functions/__tests__/cronLiveLiveTickAt.test.ts` (expect: PASS — the refactor is behavior-preserving for existing columns).
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] **Commit:**
```
git add src/lib/fetchers/shopify.ts src/inngest/functions/cronDaily.ts src/inngest/functions/cronLive.ts src/lib/__tests__/firstClickColumnsDualWrite.test.ts
git commit -m "$(cat <<'EOF'
feat(cron): dual-write first_* columns via shared toOrdersAttributionRow

Both cronDaily + cronLive now persist orders_attribution through one shared
mapper so the dual-write key-set (incl. the new first-click columns) can
never drift. Behavior-preserving for existing last-click columns.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Read back `first_*` in postgresReaders + `OrderAttributionRow`

**Files**
- Modify: `src/lib/ordersAttribution.ts` — extend `OrderAttributionRow` (:30-58).
- Modify: `src/lib/postgresReaders.ts` — `fetchOrdersAttributionFromPostgres` SELECT + row map (:1051-1094).
- Test: `src/lib/__tests__/postgresReadersFirstClick.test.ts` (Create).

`fetchOrdersAttributionFromPostgres` calls `getSupabase()` + `paginate`. The test mocks the supabase client. Follow the existing pattern in `postgresReaders.test.ts` (mock `@/lib/supabaseClient` / whatever module exports `getSupabase` — confirm the exact module the runtime reader imports before writing the mock).

- [ ] **Inspect the mock pattern first** — open `src/lib/__tests__/postgresReaders.test.ts` and replicate its `vi.mock(...)` setup for `getSupabase` so the new test stubs the same module. Use that EXACT mock shape below (the snippet assumes `getSupabase` returns a thenable query builder; adapt the chained `.from().select()` to match the existing test's helper).

- [ ] **Write the failing test** — `src/lib/__tests__/postgresReadersFirstClick.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Reader-side contract for the first-click columns. Mirrors the mock
 * pattern in postgresReaders.test.ts. Asserts the SELECT string requests
 * every first_* column and the row map surfaces them onto OrderAttributionRow
 * (NULL first-click → null fields, "no first-click signal").
 */

// A captured select string so we can assert the columns are requested.
let capturedSelect = '';

const fakeRows = [
  {
    date: '2026-06-02', store_id: 'uzoshop', order_id: 'o-1', total_cad: 100,
    source: 'google-paid', utm_source: 'google', utm_medium: 'cpc',
    utm_campaign: 'Closer', utm_content: 'ad-2', fbclid_present: false,
    gclid_present: true, referrer: '', utm_id: 'camp-2', utm_term: 'adset-2',
    line_items: '[]',
    first_touch_source: 'meta-paid', first_fbclid_present: true,
    first_gclid_present: false, first_ttclid_present: false,
    first_utm_source: 'facebook', first_utm_medium: 'cpc',
    first_utm_campaign: 'Intro', first_utm_content: 'ad-first-1',
    first_utm_id: 'camp-first-1', first_utm_term: 'adset-first-1',
    first_seen_at: '2026-06-01T10:00:00.000Z',
  },
  {
    date: '2026-06-02', store_id: 'uzoshop', order_id: 'o-2', total_cad: 50,
    source: 'meta-paid', utm_source: 'facebook', utm_medium: 'cpc',
    utm_campaign: 'X', utm_content: '', fbclid_present: true,
    gclid_present: false, referrer: '', utm_id: '', utm_term: '',
    line_items: '[]',
    // No first-click signal — all NULL.
    first_touch_source: null, first_fbclid_present: null,
    first_gclid_present: null, first_ttclid_present: null,
    first_utm_source: null, first_utm_medium: null, first_utm_campaign: null,
    first_utm_content: null, first_utm_id: null, first_utm_term: null,
    first_seen_at: null,
  },
];

vi.mock('@/lib/supabaseClient', () => ({
  getSupabase: () => ({
    from: () => ({
      select: (sel: string) => {
        capturedSelect = sel;
        const builder: any = {
          gte: () => builder,
          lte: () => builder,
          then: (res: (v: { data: unknown[]; error: null }) => void) =>
            res({ data: fakeRows, error: null }),
        };
        return builder;
      },
    }),
  }),
}));

import { fetchOrdersAttributionFromPostgres } from '@/lib/postgresReaders';

beforeEach(() => { capturedSelect = ''; });

describe('fetchOrdersAttributionFromPostgres — first-click columns', () => {
  it('requests every first_* column in the SELECT', async () => {
    await fetchOrdersAttributionFromPostgres();
    for (const col of [
      'first_touch_source', 'first_fbclid_present', 'first_gclid_present',
      'first_ttclid_present', 'first_utm_source', 'first_utm_medium',
      'first_utm_campaign', 'first_utm_content', 'first_utm_id',
      'first_utm_term', 'first_seen_at',
    ]) {
      expect(capturedSelect).toContain(col);
    }
  });

  it('surfaces populated first-click fields onto the row', async () => {
    const rows = await fetchOrdersAttributionFromPostgres();
    const r = rows.find(x => x.orderId === 'o-1')!;
    expect(r.firstTouchSource).toBe('meta-paid');
    expect(r.firstFbclidPresent).toBe(true);
    expect(r.firstGclidPresent).toBe(false);
    expect(r.firstUtmCampaign).toBe('Intro');
    expect(r.firstUtmContent).toBe('ad-first-1');
    expect(r.firstUtmId).toBe('camp-first-1');
    expect(r.firstUtmTerm).toBe('adset-first-1');
    expect(r.firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('NULL first-click → null fields (no first-click signal, not direct)', async () => {
    const rows = await fetchOrdersAttributionFromPostgres();
    const r = rows.find(x => x.orderId === 'o-2')!;
    expect(r.firstTouchSource).toBeNull();
    expect(r.firstFbclidPresent).toBe(false);
    expect(r.firstUtmId).toBeNull();
    expect(r.firstSeenAt).toBeNull();
  });
});
```

> If `postgresReaders.test.ts` mocks a different module name than `@/lib/supabaseClient` (e.g. `getSupabase` lives in `@/lib/supabase`), update the `vi.mock` target above to match it exactly before running.

- [ ] **Run (expect FAIL)** — `npx vitest run src/lib/__tests__/postgresReadersFirstClick.test.ts`
  Expected: FAIL — SELECT lacks first_* columns; row lacks `firstTouchSource` etc.

- [ ] **Minimal impl:**

  1. Extend `OrderAttributionRow` in `src/lib/ordersAttribution.ts` (after `lineItems: OrderLineItem[];` at :57, before the closing `};`):

```ts
  lineItems: OrderLineItem[];
  /** Phase 4 — first-click lens. Null when the order carries no ft_* signal
   *  ("no first-click signal", NOT 'direct'). first_* columns added by the
   *  20260603090000 migration; pre-migration rows read back as null. */
  firstTouchSource: string | null;
  firstFbclidPresent: boolean;
  firstGclidPresent: boolean;
  firstTtclidPresent: boolean;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmId: string | null;
  firstUtmTerm: string | null;
  firstSeenAt: string | null;
```

  2. In `src/lib/postgresReaders.ts`, extend the SELECT string (:1051-1055). Replace it with:

```ts
        .select(
          'date, store_id, order_id, total_cad, source, utm_source, utm_medium, ' +
            'utm_campaign, utm_content, fbclid_present, gclid_present, referrer, ' +
            'utm_id, utm_term, line_items, ' +
            'first_touch_source, first_fbclid_present, first_gclid_present, ' +
            'first_ttclid_present, first_utm_source, first_utm_medium, ' +
            'first_utm_campaign, first_utm_content, first_utm_id, ' +
            'first_utm_term, first_seen_at',
        );
```

  3. In the row push (`rows.push({...})`, :1074-1094), append first-click fields after `lineItems: includeLI ? parseLineItems(r.line_items) : [],`:

```ts
      lineItems: includeLI ? parseLineItems(r.line_items) : [],
      // Phase 4 — first-click. NULL columns → null/false (no first-click
      // signal), never coerced to 'direct'.
      firstTouchSource:
        r.first_touch_source == null ? null : String(r.first_touch_source).trim() || null,
      firstFbclidPresent: r.first_fbclid_present === true,
      firstGclidPresent: r.first_gclid_present === true,
      firstTtclidPresent: r.first_ttclid_present === true,
      firstUtmSource:
        r.first_utm_source == null ? null : String(r.first_utm_source).trim() || null,
      firstUtmMedium:
        r.first_utm_medium == null ? null : String(r.first_utm_medium).trim() || null,
      firstUtmCampaign:
        r.first_utm_campaign == null ? null : String(r.first_utm_campaign).trim() || null,
      firstUtmContent:
        r.first_utm_content == null ? null : String(r.first_utm_content).trim() || null,
      firstUtmId:
        r.first_utm_id == null ? null : String(r.first_utm_id).trim() || null,
      firstUtmTerm:
        r.first_utm_term == null ? null : String(r.first_utm_term).trim() || null,
      firstSeenAt:
        r.first_seen_at == null ? null : String(r.first_seen_at).trim() || null,
```

- [ ] **Run (expect PASS)** — `npx vitest run src/lib/__tests__/postgresReadersFirstClick.test.ts`
- [ ] **Run reader regression** — `npx vitest run src/lib/__tests__/postgresReaders.test.ts` (expect: PASS).
- [ ] **Type-check** — `npx tsc --noEmit` (expect: clean — `OrderAttributionRow` now has the fields; the `fixtures.ts:makeOrder` default will be filled in Task 5, but any test constructing `OrderAttributionRow` directly without the new fields will surface here. If `tsc` flags such a spot, it is Task 5's `makeOrder` — defer the fix to Task 5 only if it is `fixtures.ts`; otherwise fix the offending fixture in this task.)
- [ ] **Commit:**
```
git add src/lib/ordersAttribution.ts src/lib/postgresReaders.ts src/lib/__tests__/postgresReadersFirstClick.test.ts
git commit -m "$(cat <<'EOF'
feat(attribution): read back first_* columns into OrderAttributionRow

postgresReaders requests every first_* column and surfaces them onto the
row; NULL columns map to null/false ("no first-click signal"), never coerced
to 'direct'. Extends the OrderAttributionRow contract.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Sibling first-click analyzers (campaign + ad grain)

Add `analyzeFirstClickForCampaign` and `analyzeFirstClickForAd` in `attributionAnalysis.ts`, parallel to `orderMatchesCampaign` / `analyzeAttributionForAd`. Match on `firstUtmId`/`firstUtmCampaign` (campaign grain) and `firstUtmContent === adId` (ad grain). NO model-toggle param. Google-blind (excluded by the platform gate, same as last-click).

**Files**
- Modify: `src/lib/attributionAnalysis.ts` — add the two functions after `analyzeAttributionForAd` (:886).
- Modify: `src/lib/__tests__/fixtures.ts` — add first-click defaults to `makeOrder` (:17-37).
- Test: `src/lib/__tests__/analyzeFirstClick.test.ts` (Create).

- [ ] **Extend `makeOrder` first** — in `src/lib/__tests__/fixtures.ts`, add to the `makeOrder` default object (after `lineItems: [],` at :34, before `...overrides,`):

```ts
    lineItems: [],
    firstTouchSource: 'meta-paid',
    firstFbclidPresent: true,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: 'facebook',
    firstUtmMedium: 'cpc',
    firstUtmCampaign: 'Summer Sale',
    firstUtmContent: 'ad-1',
    firstUtmId: 'camp-1',
    firstUtmTerm: 'adset-1',
    firstSeenAt: '2026-05-10T08:00:00.000Z',
    ...overrides,
```

- [ ] **Write the failing test** — `src/lib/__tests__/analyzeFirstClick.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  analyzeFirstClickForCampaign,
  analyzeFirstClickForAd,
} from '@/lib/attributionAnalysis';
import { makeOrder, makeCampaign, makeAd } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-31';

describe('analyzeFirstClickForCampaign', () => {
  it('returns null for Google (first-click is Google-blind)', () => {
    const c = makeCampaign({ platform: 'Google' });
    expect(analyzeFirstClickForCampaign(c, [makeOrder()], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty orders', () => {
    expect(analyzeFirstClickForCampaign(makeCampaign(), [], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('matches on firstUtmId (tier 1) at campaign grain', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: 'camp-1', utmId: 'other', totalCad: 200, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(200, 4);
  });

  it('falls back to firstUtmCampaign name (tier 2) when firstUtmId absent', () => {
    const c = makeCampaign({ campaignName: 'Intro Camp', campaignId: 'camp-X', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: null, firstUtmCampaign: 'intro camp', totalCad: 150, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(150, 4);
  });

  it('does NOT match when neither first-click key matches', () => {
    const c = makeCampaign({ campaignId: 'camp-1', campaignName: 'A', spend: 100 });
    const orders = [makeOrder({ firstUtmId: 'other', firstUtmCampaign: 'B', date: '2026-05-10' })];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('ignores orders with no first-click signal (firstUtmId AND firstUtmCampaign null)', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: null, firstUtmCampaign: null, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('respects store + date window', () => {
    const c = makeCampaign({ campaignId: 'camp-1', storeId: 'uzoshop', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'zolplus', firstUtmId: 'camp-1', date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', firstUtmId: 'camp-1', date: '2026-04-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('computes first-click ROAS and coverage vs total matched first-click revenue', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: 'camp-1', totalCad: 300, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickRoas).toBeCloseTo(3, 4);
  });
});

describe('analyzeFirstClickForAd', () => {
  it('matches on firstUtmContent === adId', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmContent: 'ad-7', totalCad: 100, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForAd(ad, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(100, 4);
    expect(r.firstClickRoas).toBeCloseTo(2, 4);
  });

  it('returns null for Google', () => {
    expect(analyzeFirstClickForAd(makeAd({ platform: 'Google' }), [makeOrder()], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('does not match a different ad', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const orders = [makeOrder({ firstUtmContent: 'ad-99', date: '2026-05-10' })];
    const r = analyzeFirstClickForAd(ad, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('marks the result googleBlind = true (surfaced in tooltip)', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const r = analyzeFirstClickForAd(ad, [makeOrder({ firstUtmContent: 'ad-7', date: '2026-05-10' })], DATE_FROM, DATE_TO)!;
    expect(r.googleBlind).toBe(true);
  });
});
```

- [ ] **Run (expect FAIL)** — `npx vitest run src/lib/__tests__/analyzeFirstClick.test.ts`
  Expected: FAIL — `analyzeFirstClickForCampaign` / `analyzeFirstClickForAd` are not exported.

- [ ] **Minimal impl** — in `src/lib/attributionAnalysis.ts`, after `analyzeAttributionForAd` (after :886), add:

```ts
// ============================================================================
// First-click lens (Phase 4) — sibling analyzers
// ============================================================================
//
// Parallel to orderMatchesCampaign / analyzeAttributionForAd but matching on
// the order's FIRST-touch UTM fields (firstUtmId / firstUtmCampaign at
// campaign grain; firstUtmContent at ad grain). NO model-toggle param — this
// is a separate, always-first-click function so the call site decides which
// lens to render. GOOGLE-BLIND: the matcher excludes Google (same as the
// last-click analyzer) — surfaced via `googleBlind` for the tooltip.

export type FirstClickAnalysis = {
  /** Sum of totalCad over orders whose FIRST touch matches this entity. */
  firstClickRevenue: number;
  /** Count of first-click-matched orders. */
  firstClickOrders: number;
  /** firstClickRevenue / spend. 0 when spend <= 0. */
  firstClickRoas: number;
  /** True (always, for the entities this analyzer accepts) — first-click is
   *  Google-blind. Threaded so the UI tooltip can state the caveat. */
  googleBlind: boolean;
};

/**
 * First-click match at CAMPAIGN grain.
 *   Tier 1 — firstUtmId === campaignId (authoritative when present).
 *   Tier 2 — firstUtmCampaign === campaignName (case-insensitive, trimmed).
 * Orders with NO first-click signal (both keys null/empty) never match.
 * Returns null for Google / any non-Meta-non-TikTok platform, and for empty
 * orders — mirrors analyzeAttribution's early exits.
 */
export function analyzeFirstClickForCampaign(
  campaign: {
    campaignName: string;
    campaignId?: string;
    storeId: string;
    platform: string;
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
): FirstClickAnalysis | null {
  if (campaign.platform !== 'Meta' && campaign.platform !== 'TikTok') return null;
  if (!orders || orders.length === 0) return null;

  const matched = orders.filter(o => {
    if (o.storeId !== campaign.storeId) return false;
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (!Number.isFinite(o.totalCad)) return false;
    // Tier 1 — first-click utm_id is authoritative when present.
    if (o.firstUtmId) {
      return !!campaign.campaignId
        && o.firstUtmId.trim() === campaign.campaignId.trim();
    }
    // Tier 2 — fall back to first-click campaign-name match.
    if (o.firstUtmCampaign) {
      return o.firstUtmCampaign.trim().toLowerCase()
           === campaign.campaignName.trim().toLowerCase();
    }
    return false; // no first-click signal
  });

  const firstClickRevenue = matched.reduce((s, o) => s + o.totalCad, 0);
  const firstClickOrders = matched.length;
  const firstClickRoas = campaign.spend > 0 ? firstClickRevenue / campaign.spend : 0;
  return { firstClickRevenue, firstClickOrders, firstClickRoas, googleBlind: true };
}

/**
 * First-click match at AD grain: firstUtmContent === adId. Same early exits
 * and Google-blind contract as the campaign-grain analyzer.
 */
export function analyzeFirstClickForAd(
  ad: {
    adId: string;
    adName: string;
    storeId: string;
    platform: string;
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
): FirstClickAnalysis | null {
  if (ad.platform !== 'Meta' && ad.platform !== 'TikTok') return null;
  if (!orders || orders.length === 0) return null;
  if (!ad.adId) return null;

  const matched = orders.filter(o => {
    if (o.storeId !== ad.storeId) return false;
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (!Number.isFinite(o.totalCad)) return false;
    return !!o.firstUtmContent && o.firstUtmContent.trim() === ad.adId.trim();
  });

  const firstClickRevenue = matched.reduce((s, o) => s + o.totalCad, 0);
  const firstClickOrders = matched.length;
  const firstClickRoas = ad.spend > 0 ? firstClickRevenue / ad.spend : 0;
  return { firstClickRevenue, firstClickOrders, firstClickRoas, googleBlind: true };
}
```

- [ ] **Run (expect PASS)** — `npx vitest run src/lib/__tests__/analyzeFirstClick.test.ts`
- [ ] **Run last-click + mapping regression** — `npx vitest run src/lib/__tests__/analyzeAttributionForAd.test.ts src/lib/__tests__/attributionAnalysis.test.ts src/lib/__tests__/orderSourceContract.test.ts` (expect: PASS — `makeOrder` change is additive; existing tests don't read first-click).
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] **Commit:**
```
git add src/lib/attributionAnalysis.ts src/lib/__tests__/fixtures.ts src/lib/__tests__/analyzeFirstClick.test.ts
git commit -m "$(cat <<'EOF'
feat(attribution): sibling first-click analyzers (campaign + ad grain)

analyzeFirstClickForCampaign matches firstUtmId (tier 1) / firstUtmCampaign
(tier 2); analyzeFirstClickForAd matches firstUtmContent===adId. No
model-toggle param. Google-blind (platform gate excludes Google), surfaced
via googleBlind for the tooltip. Orders with no first-click signal never
match.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Store credit via existing `campaignStoreMap` (incl. TikTok override)

Prove the first-click analyzer credits the store via the **existing** `campaignStoreMap` (incl. TikTok shared-account `uzoshop`-default override), never raw account totals. The analyzer already takes `storeId` on the campaign/ad object; this task verifies that the resolved store (from `resolveStoreForCampaign`) is what filters orders — by composing the two helpers exactly as the UI will.

**Files**
- Test: `src/lib/__tests__/firstClickStoreCredit.test.ts` (Create).
- No impl change expected (this is a contract/composition test). If it fails, the fix is to make `analyzeFirstClickForCampaign` filter by the passed `storeId` (already does) — so this test should pass once Task 5 is in.

- [ ] **Write the test** — `src/lib/__tests__/firstClickStoreCredit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveStoreForCampaign, campaignStoreKey } from '@/lib/campaignStoreMap';
import { analyzeFirstClickForCampaign } from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-31';

/**
 * First-click must credit the store via the EXISTING campaignStoreMap,
 * incl. the TikTok shared-account per-campaign override (default uzoshop,
 * remappable). We compose resolveStoreForCampaign -> analyzeFirstClickForCampaign
 * exactly as the UI does, proving the override re-routes credit.
 */
describe('first-click store credit via campaignStoreMap', () => {
  it('TikTok shared-account campaign defaults to uzoshop', () => {
    const store = resolveStoreForCampaign({}, 'tiktok', 'ADV-SHARED', 'tt-camp-1', 'uzoshop');
    expect(store).toBe('uzoshop');

    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'uzoshop', firstUtmId: 'tt-camp-1', totalCad: 100, date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', storeId: 'usmile360', firstUtmId: 'tt-camp-1', totalCad: 999, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(
      { campaignName: 'TT', campaignId: 'tt-camp-1', storeId: store, platform: 'TikTok', spend: 50 },
      orders, DATE_FROM, DATE_TO,
    )!;
    // Only the uzoshop order is credited; the usmile360 order is excluded.
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(100, 4);
  });

  it('per-campaign override re-routes TikTok credit to the mapped store', () => {
    const map = { [campaignStoreKey('tiktok', 'ADV-SHARED', 'tt-camp-1')]: 'usmile360' };
    const store = resolveStoreForCampaign(map, 'tiktok', 'ADV-SHARED', 'tt-camp-1', 'uzoshop');
    expect(store).toBe('usmile360');

    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'uzoshop', firstUtmId: 'tt-camp-1', totalCad: 100, date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', storeId: 'usmile360', firstUtmId: 'tt-camp-1', totalCad: 250, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(
      { campaignName: 'TT', campaignId: 'tt-camp-1', storeId: store, platform: 'TikTok', spend: 50 },
      orders, DATE_FROM, DATE_TO,
    )!;
    // Credit now follows the override → usmile360's order only.
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(250, 4);
  });
});
```

- [ ] **Run (expect PASS)** — `npx vitest run src/lib/__tests__/firstClickStoreCredit.test.ts`
  (If it FAILS, the analyzer is not filtering by `storeId` — fix `analyzeFirstClickForCampaign` so `if (o.storeId !== campaign.storeId) return false;` is present, then re-run.)
- [ ] **Run the FULL mapping-preservation suite** — these MUST stay green:
```
npx vitest run src/lib/__tests__/campaignStoreMap.dom.test.ts src/lib/__tests__/campaignStoreMapV2.dom.test.ts --config vitest.config.dom.ts
npx vitest run src/lib/__tests__/productCentricViewSumConservation.test.ts src/lib/__tests__/cannibalizationDetection.test.ts src/lib/__tests__/campaignProductMap.test.ts src/lib/__tests__/campaignsAggregator.test.ts
```
  (The `tiktokFetcherStoreMapping.test` lives under `src/lib/__tests__` or `src/inngest/...` — run whichever path `ls`/`find` resolves: `npx vitest run "$(find src -name 'tiktokFetcherStoreMapping.test.ts')"`.)
- [ ] **Commit:**
```
git add src/lib/__tests__/firstClickStoreCredit.test.ts
git commit -m "$(cat <<'EOF'
test(attribution): first-click credits store via campaignStoreMap

Proves first-click revenue follows resolveStoreForCampaign incl. the TikTok
shared-account override (default uzoshop, remappable) — never raw account
totals. Mapping-preservation suites stay green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Pure `firstClickDelta` helper (delta + label)

A tiny pure module the UI uses to compute the headline delta between first-click and last-click ROAS, plus an RTL Hebrew label. Keeping it pure makes it node-testable and keeps the components thin.

**Files**
- Create: `src/components/firstClickDelta.ts`.
- Test: `src/components/__tests__/firstClickDelta.test.ts` (node — NOT `.dom.`).

- [ ] **Write the failing test** — `src/components/__tests__/firstClickDelta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { firstClickDelta } from '@/components/firstClickDelta';

describe('firstClickDelta', () => {
  it('positive delta when first-click ROAS exceeds last-click', () => {
    const d = firstClickDelta(3, 2);
    expect(d.delta).toBeCloseTo(1, 6);
    expect(d.direction).toBe('up');
    expect(d.label).toContain('+'); // "+1.00x" style
  });

  it('negative delta when first-click is below last-click', () => {
    const d = firstClickDelta(1.5, 2.5);
    expect(d.delta).toBeCloseTo(-1, 6);
    expect(d.direction).toBe('down');
  });

  it('flat when equal', () => {
    const d = firstClickDelta(2, 2);
    expect(d.delta).toBe(0);
    expect(d.direction).toBe('flat');
  });

  it('null when either side is non-finite (no comparison possible)', () => {
    expect(firstClickDelta(NaN, 2)).toBeNull();
    expect(firstClickDelta(2, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('null when last-click ROAS is 0 (cannot frame a meaningful delta)', () => {
    expect(firstClickDelta(3, 0)).toBeNull();
  });
});
```

- [ ] **Run (expect FAIL)** — `npx vitest run src/components/__tests__/firstClickDelta.test.ts`
- [ ] **Minimal impl** — `src/components/firstClickDelta.ts`:

```ts
/**
 * Phase 4 — pure helper for the first-click headline delta. Compares
 * first-click ROAS vs last-click ("ROAS Shopify"). Returns null when no
 * meaningful comparison is possible. Pure — no IO, no React.
 */
export type FirstClickDelta = {
  /** firstClickRoas - lastClickRoas. */
  delta: number;
  direction: 'up' | 'down' | 'flat';
  /** RTL-safe LTR-isolated label, e.g. "+1.00x" / "-0.50x" / "0.00x". */
  label: string;
};

export function firstClickDelta(
  firstClickRoas: number,
  lastClickRoas: number,
): FirstClickDelta | null {
  if (!Number.isFinite(firstClickRoas) || !Number.isFinite(lastClickRoas)) return null;
  if (lastClickRoas === 0) return null;
  const delta = firstClickRoas - lastClickRoas;
  const direction: FirstClickDelta['direction'] =
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sign = delta > 0 ? '+' : '';
  const label = `${sign}${delta.toFixed(2)}x`;
  return { delta, direction, label };
}
```

- [ ] **Run (expect PASS)** — `npx vitest run src/components/__tests__/firstClickDelta.test.ts`
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] **Commit:**
```
git add src/components/firstClickDelta.ts src/components/__tests__/firstClickDelta.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): pure firstClickDelta helper for the headline delta

Compares first-click vs last-click ROAS; returns null when no meaningful
comparison exists (non-finite, or last-click ROAS = 0). RTL-safe label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — `FirstClickCoverageChip` component (separate coverage chip)

A small, token-driven, dual-mode chip showing first-click coverage = first-click-matched orders ÷ total deterministic-matched orders. Quiet by default; visually prominent only when low. States the Google-blind caveat in its tooltip.

**Files**
- Create: `src/components/FirstClickCoverageChip.tsx`.
- Test: `src/components/__tests__/FirstClickCoverageChip.dom.test.tsx` (DOM).

- [ ] **Write the failing test** — `src/components/__tests__/FirstClickCoverageChip.dom.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';

describe('FirstClickCoverageChip', () => {
  it('renders the coverage percentage', () => {
    render(<FirstClickCoverageChip firstClickOrders={3} lastClickOrders={10} />);
    // 3/10 = 30%
    expect(screen.getByTestId('first-click-coverage-chip').textContent).toContain('30%');
  });

  it('renders 0% (never NaN) when there are no last-click orders', () => {
    render(<FirstClickCoverageChip firstClickOrders={0} lastClickOrders={0} />);
    const chip = screen.getByTestId('first-click-coverage-chip');
    expect(chip.textContent).toContain('0%');
    expect(chip.textContent).not.toContain('NaN');
  });

  it('uses the quiet tone when coverage is healthy and a warn tone when low', () => {
    const { rerender } = render(
      <FirstClickCoverageChip firstClickOrders={9} lastClickOrders={10} />,
    );
    expect(screen.getByTestId('first-click-coverage-chip').getAttribute('data-tone')).toBe('quiet');
    rerender(<FirstClickCoverageChip firstClickOrders={1} lastClickOrders={10} />);
    expect(screen.getByTestId('first-click-coverage-chip').getAttribute('data-tone')).toBe('warn');
  });

  it('exposes the Google-blind caveat in the title', () => {
    render(<FirstClickCoverageChip firstClickOrders={3} lastClickOrders={10} />);
    expect(screen.getByTestId('first-click-coverage-chip').getAttribute('title')).toContain('Google');
  });
});
```

- [ ] **Run (expect FAIL)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/FirstClickCoverageChip.dom.test.tsx`
- [ ] **Minimal impl** — `src/components/FirstClickCoverageChip.tsx`:

```tsx
import { cn } from '@/lib/utils';

/**
 * Phase 4 — first-click coverage chip. Coverage = first-click-matched orders
 * ÷ last-click(deterministic)-matched orders. First-click coverage is a
 * DIRECTIONAL FLOOR (<= last-click) because store-side capture (cookie/cart
 * attribute) is lossier than the platform click-id. Quiet by default; warn
 * tone only when low. Google-blind caveat in the title. Token-driven, both
 * themes (on-band/scrim tokens — 2026-06-01 readability standard).
 */
export function FirstClickCoverageChip({
  firstClickOrders,
  lastClickOrders,
}: {
  firstClickOrders: number;
  lastClickOrders: number;
}) {
  const coverage = lastClickOrders > 0 ? firstClickOrders / lastClickOrders : 0;
  const pct = Math.round(coverage * 100);
  // Quiet unless meaningfully low (<50% of last-click captured first-touch).
  const tone: 'quiet' | 'warn' = coverage >= 0.5 ? 'quiet' : 'warn';
  const title =
    `כיסוי first-click: ${firstClickOrders} מתוך ${lastClickOrders} הזמנות מתויגות. ` +
    'תמיד <= last-click (לכידת cookie/cart לוסית יותר מ-click-id). ' +
    'first-click עיוור ל-Google (כמו last-click).';
  return (
    <span
      data-testid="first-click-coverage-chip"
      data-tone={tone}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
        tone === 'quiet'
          ? 'bg-glass-2 text-ink-secondary'
          : 'bg-status-warningBg text-status-warningFg',
      )}
    >
      <bdi dir="ltr">{pct}%</bdi>
      <span>first-click</span>
    </span>
  );
}
```

- [ ] **Run (expect PASS)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/FirstClickCoverageChip.dom.test.tsx`
- [ ] **Type-check** — `npx tsc --noEmit` (if `bg-status-warningBg`/`text-status-warningFg`/`bg-glass-2` tokens differ in this repo, swap to the exact token names used elsewhere — confirm against `AdsDrawer.tsx:599-602` which uses `bg-status-warningBg text-status-warningFg` and `bg-glass-2 text-ink-secondary`).
- [ ] **Commit:**
```
git add src/components/FirstClickCoverageChip.tsx src/components/__tests__/FirstClickCoverageChip.dom.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): FirstClickCoverageChip — separate first-click coverage chip

Coverage = first-click ÷ last-click orders; quiet by default, warn when low.
Directional-floor + Google-blind caveats in the title. Token-driven, both
themes (2026-06-01 readability standard).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Render first-click beside last-click in `CampaignsTable`

Add a first-click value cell + headline delta (on hover) + coverage chip beside the existing "ROAS Shopify" column, at ~60-70% prominence vs. MER. The first-click analysis is computed per-campaign from the existing orders data the table already has.

**Files**
- Modify: `src/components/CampaignsTable.tsx` — header region (~:1924-1995) + matching body cell + a per-campaign first-click memo.
- Test: `src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx` (DOM).

Because `CampaignsTable` is large and data-wired, the DOM test renders the table with a minimal fixture and asserts the new first-click cell/chip appear. **Before writing the test, open `CampaignsTable.tsx` and confirm:** (a) the prop name carrying orders-attribution data (likely an `OrdersAttributionResponse`), (b) the campaign-row shape (`campaignId`, `campaignName`, `storeId`, `platform`, `spend`), (c) the range props. Build the test fixture from those exact props. The snippet below assumes a `data-testid="first-click-roas-<campaignId>"` cell and reuses the table's existing render entry point.

- [ ] **Inspect the table's props + row shape** and adapt the fixture accordingly. Note the existing column-config object pattern (the header map at ~:1907-1995) — the first-click cell is added as a sibling of `roasShopify`.

- [ ] **Write the failing test** — `src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignsTable } from '@/components/CampaignsTable';

// Mock cloud sync / any localStorage-backed map helpers the table imports,
// matching the pattern used by other CampaignsTable DOM tests (confirm the
// exact module list before running).
vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

/**
 * Phase 4 — first-click cell renders beside last-click. This test wires the
 * MINIMUM props the table needs to render one Meta campaign row plus one
 * orders-attribution order whose FIRST touch matches that campaign.
 *
 * NOTE: the exact prop names/shapes below must be reconciled against the real
 * CampaignsTable signature before running (see the inspect step). Adjust the
 * fixture to the real props; keep the assertions.
 */
describe('CampaignsTable — first-click lens', () => {
  it('renders a first-click ROAS cell beside ROAS Shopify for a Meta campaign', () => {
    const props = makeFirstClickProps();
    render(<CampaignsTable {...props} />);
    expect(screen.getByTestId('first-click-roas-camp-1')).toBeTruthy();
    expect(screen.getByTestId('first-click-coverage-chip')).toBeTruthy();
  });
});

// `makeFirstClickProps` CLONES the canonical working CampaignsTable render
// fixture from src/components/__tests__/campaignsTableAllStoresRegression.dom.test.tsx
// (which already renders <CampaignsTable> with a valid, typed props object + the
// SWR mock), then overrides to: rows → one Meta campaign 'camp-1' (storeId
// 'uzoshop', spend 100); ordersAttrData → [{ firstUtmId: 'camp-1', totalCad: 300,
// date within range }]. Type it to React.ComponentProps<typeof CampaignsTable>.
function makeFirstClickProps(): React.ComponentProps<typeof CampaignsTable> { /* clone + override per the comment above */ }
```

> **CONCRETIZE-AT-EXEC (the one spot in these plans left to fill at execution):** CampaignsTable is ~2500 lines with a large prop signature, and Plan C is GATED (runs after Plans A+B soak — likely weeks out, by which time the signature may shift). So `makeFirstClickProps` is specified by reference: copy the base props object from `campaignsTableAllStoresRegression.dom.test.tsx` and apply the two documented overrides. The two `getByTestId` assertions are the load-bearing contract and do not change. (AdsDrawer Task 10 follows the same clone-the-existing-render-test pattern.)

- [ ] **Run (expect FAIL)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx`
- [ ] **Minimal impl** — in `src/components/CampaignsTable.tsx`:

  1. Add imports near the existing attribution imports:

```ts
import { analyzeFirstClickForCampaign, type FirstClickAnalysis } from '@/lib/attributionAnalysis';
import { firstClickDelta } from '@/components/firstClickDelta';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';
import { Money } from '@/components/ui/Money';
```

  2. Add a per-campaign first-click memo near where the table computes per-campaign attribution (find the existing `analyzeAttribution`/deterministic-revenue memo around the `info.deterministicRevenue` usage at :1150). Add a `Map<campaignId, FirstClickAnalysis | null>` computed from the same orders array + range the table already holds:

```ts
  // Phase 4 — per-campaign first-click analysis. Keyed by campaignId so the
  // body cell can look it up O(1). Uses the SAME orders + range the table
  // already has; store credit follows the row's resolved storeId (mapping-
  // aware — the rows are already mapping-resolved upstream).
  const firstClickByCampaign = useMemo(() => {
    const out = new Map<string, FirstClickAnalysis | null>();
    for (const c of /* the table's campaign-row list */ campaignRows) {
      out.set(
        c.campaignId,
        analyzeFirstClickForCampaign(
          {
            campaignName: c.campaignName,
            campaignId: c.campaignId,
            storeId: c.storeId,
            platform: c.platform,
            spend: c.spend,
          },
          ordersForAnalysis,   // the existing OrderAttributionRow[] the table uses
          rangeFrom,           // the table's existing range-from
          rangeTo,             // the table's existing range-to
        ),
      );
    }
    return out;
  }, [campaignRows, ordersForAnalysis, rangeFrom, rangeTo]);
```

  > Replace `campaignRows`, `ordersForAnalysis`, `rangeFrom`, `rangeTo` with the table's REAL identifiers (from the inspect step). The existing last-click memo already derives these — reuse them.

  3. Add a `firstClickRoas` header entry as a sibling of `roasShopify` in the header map (~:1924), with `~60-70%` prominence styling (smaller, muted label):

```tsx
                firstClickRoas: (
                  <SortHeader
                    key="firstClickRoas"
                    label={
                      <span className="inline-flex flex-col items-center leading-tight opacity-80">
                        <span>first-click</span>
                        <span className="text-[9px] text-ink-muted font-normal">מבוא ללקוח</span>
                      </span>
                    }
                    sortKey="firstClickRoas"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[96px]"
                    dataColId="firstClickRoas"
                    tooltip={'ROAS לפי first-click (המגע הראשון של הלקוח, מתוך ft_* בעגלה). מודד כמה הקמפיין "מכניס" לקוחות חדשים — לא רק סוגר. עיוור ל-Google (כמו last-click). הכיסוי תמיד <= last-click כי לכידת ה-cookie לוסית יותר מ-click-id. השווה ל-ROAS Shopify (last-click) — ה-delta על hover.'}
                  />
                ),
```

  4. Add the matching body cell wherever the `roasShopify` body cell is rendered (the row renderer — likely in `CampaignsTableRow.tsx`; if so, pass `firstClickByCampaign.get(row.campaignId)` and the row's last-click ROAS down as props and render there). The cell:

```tsx
                {/* Phase 4 — first-click value + headline delta on hover. */}
                <td className="px-3 py-2 text-center" data-testid={`first-click-roas-${row.campaignId}`}>
                  {(() => {
                    const fc = firstClickByCampaign.get(row.campaignId) ?? null;
                    if (!fc) return <span className="text-ink-muted text-xs">—</span>;
                    const lastClickRoas = row.spend > 0 ? row.deterministicRevenue / row.spend : 0;
                    const d = firstClickDelta(fc.firstClickRoas, lastClickRoas);
                    const tooltip =
                      `first-click ROAS: ${fc.firstClickRoas.toFixed(2)}x (${fc.firstClickOrders} הזמנות, ${fc.firstClickRevenue.toFixed(0)} CAD)\n` +
                      `last-click ROAS Shopify: ${lastClickRoas.toFixed(2)}x\n` +
                      (d ? `delta: ${d.label}\n` : '') +
                      '\nfirst-click = המגע הראשון (מבוא ללקוח). עיוור ל-Google. כיסוי <= last-click.';
                    return (
                      <HelpTooltip content={tooltip}>
                        <div className="inline-flex flex-col items-center gap-0.5 opacity-80">
                          <span className="font-medium tabular-nums text-ink">
                            {fc.firstClickRoas > 0 ? fc.firstClickRoas.toFixed(2) : '—'}
                          </span>
                          {d && (
                            <span
                              className={cn(
                                'text-[10px] font-semibold tabular-nums',
                                d.direction === 'up'   ? 'text-status-greenFg'
                              : d.direction === 'down' ? 'text-status-redFg'
                              :                          'text-ink-muted',
                              )}
                            >
                              <bdi dir="ltr">{d.label}</bdi>
                            </span>
                          )}
                          <FirstClickCoverageChip
                            firstClickOrders={fc.firstClickOrders}
                            lastClickOrders={row.deterministicOrders}
                          />
                        </div>
                      </HelpTooltip>
                    );
                  })()}
                </td>
```

  > Use the row's REAL field names for `deterministicRevenue` / `deterministicOrders` / `spend` / `campaignId` (from the inspect step). `HelpTooltip`, `cn`, `SortHeader` are already imported in this file. If the body cell lives in `CampaignsTableRow.tsx`, thread `firstClick` + `lastClickRoas` as new props and render the cell there; the `data-testid` must remain `first-click-roas-<campaignId>`.

  5. Register the `firstClickRoas` column in the table's column-order/visibility config so it renders between `roasShopify` and `roasShopifyPlatform` (follow the existing column-registration pattern — add the id to the same list `roasShopify` appears in).

- [ ] **Run (expect PASS)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx`
- [ ] **Run CampaignsTable regression** — `npx vitest run --config vitest.config.dom.ts "$(find src/components/__tests__ -name 'CampaignsTable*.dom.test.tsx')"` (expect: PASS).
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] **Commit:**
```
git add src/components/CampaignsTable.tsx src/components/CampaignsTableRow.tsx src/components/__tests__/CampaignsTableFirstClick.dom.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): first-click ROAS + delta + coverage chip in CampaignsTable

Renders first-click value beside last-click ROAS Shopify at ~60-70%
prominence; headlines the delta on hover (up/down/flat) with a separate
first-click coverage chip. Google-blind + directional-floor caveats in the
tooltip. Mapping-aware (store credit follows the resolved row store).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Render first-click beside last-click in `AdsDrawer`

Mirror Task 9 at the ad grain inside the drawer's per-ad "ROAS Shopify" cell.

**Files**
- Modify: `src/components/AdsDrawer.tsx` — per-ad memo (:287-300) + the ROAS Shopify body cell (:586-623) + header (:512-516).
- Test: extend the existing AdsDrawer DOM test if one exists; else add `src/components/__tests__/AdsDrawerFirstClick.dom.test.tsx`. **Inspect** for an existing `AdsDrawer*.dom.test.tsx` first and follow its render-fixture pattern.

- [ ] **Inspect** existing AdsDrawer DOM test fixture (props: `adAccounts`, the per-ad rows, orders-attribution, range). Build the new test from that exact shape.

- [ ] **Write the failing test** — `src/components/__tests__/AdsDrawerFirstClick.dom.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdsDrawer } from '@/components/AdsDrawer';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

/**
 * Phase 4 — first-click ad cell renders beside last-click ROAS Shopify in the
 * drawer. Props built from the real AdsDrawer signature (inspect step); the
 * load-bearing assertion is the first-click cell test id.
 */
describe('AdsDrawer — first-click lens', () => {
  it('renders a first-click cell for an ad whose first touch matches', () => {
    render(
      // @ts-expect-error props filled from the real signature during impl
      <AdsDrawer {...makeAdsDrawerFirstClickProps()} />,
    );
    expect(screen.getByTestId('first-click-roas-ad-7')).toBeTruthy();
  });
});

function makeAdsDrawerFirstClickProps(): any {
  // Filled during impl from the real AdsDrawer prop shape:
  //   one Meta ad row { adId: 'ad-7', storeId: 'uzoshop', spend: 50 }
  //   one order { firstUtmContent: 'ad-7', totalCad: 100, date in range }
  return {};
}
```

- [ ] **Run (expect FAIL)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/AdsDrawerFirstClick.dom.test.tsx`
- [ ] **Minimal impl** — in `src/components/AdsDrawer.tsx`:

  1. Add imports:

```ts
import { analyzeFirstClickForAd } from '@/lib/attributionAnalysis';
import { firstClickDelta } from '@/components/firstClickDelta';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';
```

  2. Add a per-ad first-click memo beside the existing `attributionByAd` memo (:287-300):

```ts
  // Phase 4 — per-ad first-click analysis, keyed exactly like attributionByAd
  // (a.adId || a.adName) so the cell looks it up O(1).
  const firstClickByAd = useMemo(() => {
    const out = new Map<string, ReturnType<typeof analyzeFirstClickForAd>>();
    for (const a of /* the drawer's per-ad list */ adsForAnalysis) {
      out.set(
        a.adId || a.adName,
        analyzeFirstClickForAd(
          { adId: a.adId, adName: a.adName, storeId: a.storeId, platform: a.platform, spend: a.spend },
          ordersForAnalysis,  // the drawer's existing OrderAttributionRow[]
          rangeFrom,
          rangeTo,
        ),
      );
    }
    return out;
  }, [adsForAnalysis, ordersForAnalysis, rangeFrom, rangeTo]);
```

  > Replace `adsForAnalysis`, `ordersForAnalysis`, `rangeFrom`, `rangeTo` with the drawer's REAL identifiers (the `attributionByAd` memo already derives them — reuse).

  3. Add a header `<th>` after the existing "ROAS Shopify" header (:512-516):

```tsx
                      <th className="font-medium px-3 py-2 text-center text-ink-secondary opacity-80">
                        <HelpTooltip content="ROAS לפי first-click (utm_content={{ad.id}} מהמגע הראשון). מבוא ללקוח, לא רק סגירה. עיוור ל-Google. כיסוי <= last-click.">
                          <span>first-click</span>
                        </HelpTooltip>
                      </th>
```

  4. Add the body cell after the existing deterministic ROAS cell (after :623), inside the `sortedAds.map` row:

```tsx
                          {/* Phase 4 — first-click ROAS + delta. */}
                          <td className="px-3 py-2 text-center" data-testid={`first-click-roas-${a.adId}`}>
                            {(() => {
                              const fc = firstClickByAd.get(a.adId || a.adName) ?? null;
                              const adAttr = attributionByAd.get(a.adId || a.adName) ?? null;
                              if (!fc) return <span className="text-ink-muted text-xs">—</span>;
                              const lastClickRoas = a.spend > 0 && adAttr
                                ? adAttr.deterministicRevenue / a.spend
                                : 0;
                              const d = firstClickDelta(fc.firstClickRoas, lastClickRoas);
                              const tooltip =
                                `first-click ROAS: ${fc.firstClickRoas.toFixed(2)}x (${fc.firstClickOrders} הזמנות)\n` +
                                `last-click ROAS Shopify: ${lastClickRoas.toFixed(2)}x\n` +
                                (d ? `delta: ${d.label}\n` : '') +
                                '\nfirst-click = המגע הראשון. עיוור ל-Google. כיסוי <= last-click.';
                              return (
                                <HelpTooltip content={tooltip}>
                                  <div className="inline-flex flex-col items-center gap-0.5 opacity-80">
                                    <span className="font-medium tabular-nums text-ink">
                                      {fc.firstClickRoas > 0 ? formatNumber(fc.firstClickRoas) : '—'}
                                    </span>
                                    {d && (
                                      <span className={cn(
                                        'text-[10px] font-semibold tabular-nums',
                                        d.direction === 'up'   ? 'text-status-greenFg'
                                      : d.direction === 'down' ? 'text-status-redFg'
                                      :                          'text-ink-muted',
                                      )}>
                                        <bdi dir="ltr">{d.label}</bdi>
                                      </span>
                                    )}
                                    <FirstClickCoverageChip
                                      firstClickOrders={fc.firstClickOrders}
                                      lastClickOrders={adAttr ? adAttr.deterministicOrders : 0}
                                    />
                                  </div>
                                </HelpTooltip>
                              );
                            })()}
                          </td>
```

  > `formatNumber`, `cn`, `HelpTooltip` are already imported in `AdsDrawer.tsx`. Keep the `<th>` count and `<td>` count in sync (one header, one cell per row).

- [ ] **Run (expect PASS)** — `npx vitest run --config vitest.config.dom.ts src/components/__tests__/AdsDrawerFirstClick.dom.test.tsx`
- [ ] **Run AdsDrawer regression** — `npx vitest run --config vitest.config.dom.ts "$(find src/components/__tests__ -name 'AdsDrawer*.dom.test.tsx')"` (expect: PASS).
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] **Commit:**
```
git add src/components/AdsDrawer.tsx src/components/__tests__/AdsDrawerFirstClick.dom.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): first-click ROAS + delta in AdsDrawer per-ad table

Mirrors the CampaignsTable lens at ad grain (utm_content match). First-click
value beside last-click ROAS Shopify at ~60-70% prominence; delta on hover;
coverage chip. Google-blind + floor caveats in the tooltip.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — Operator install steps + CAPI-safety gate (docs only)

Document the store-side capture as operator install steps (NOT code). Order: uzoshop + zolplus FIRST (theme/pixel), usmile LAST (headless beacon). Include the CAPI-safety checklist as a gate before trusting numbers.

**Files**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (append a new top-level section).
- Test: none (docs). Per project memory, doc currency is a pre-push gate; this task satisfies it for Phase 4.

- [ ] **Append the section** to `docs/ROAS-Dashboard-User-Manual.md` (cwd note: the manual is at the repo root `docs/`, one level up from `dashboard-web`):

````markdown
## First-click lens — store-side capture (Phase 4, operator install)

The first-click ROAS column is empty until each store writes the `_ft_*` cart
attributes. The dashboard side is already live; this section is the **manual,
outside-repo install** per store. Roll out in this order; do NOT trust the
first-click numbers for a store until its CAPI-safety gate (below) passes.

### Canonical contract (all stores)
- Write a first-party cookie ONCE on the customer's first landing, capturing
  whatever of these are on the URL: `fbclid`, `gclid`, `ttclid`,
  `utm_source/medium/campaign/content/id/term`, plus a `set_at` ISO timestamp.
  **Write-once:** if the cookie already exists, do NOT overwrite it.
- On add-to-cart, copy the cookie values into cart attributes via
  `POST /cart/update.js` with keys **single-underscore** `_ft_fbclid`,
  `_ft_gclid`, `_ft_ttclid`, `_ft_utm_source`, `_ft_utm_medium`,
  `_ft_utm_campaign`, `_ft_utm_content`, `_ft_utm_id`, `_ft_utm_term`,
  `_ft_set_at`. Shopify carries `_`-prefixed attributes into the order's
  `note_attributes`; the dashboard reads them back (no extra API call).
- **ZERO** `fbq` / `gtag` / `ttq` / `_fbq` / `snaptr` in any snippet. The ONLY
  outbound call is Shopify `/cart/update.js` (uzoshop/zolplus) or our
  `/api/events/cart` (usmile). No server-side conversion sender.

### Step A — uzoshop + zolplus (FIRST): Custom Pixel + theme JS
1. In Shopify admin → Settings → Customer events → Add custom pixel. Paste a
   pixel that, on `page_viewed`, reads `document.location.search`, and if the
   `_ft` cookie is absent, sets it (write-once) to a JSON blob of the params
   above + `set_at = new Date().toISOString()`. Cookie: first-party,
   `SameSite=Lax`, ~90-day expiry. NO pixel/analytics SDK calls.
2. In the theme (or a theme app extension), on the add-to-cart handler, read
   the `_ft` cookie and `fetch('/cart/update.js', { method:'POST',
   headers:{'Content-Type':'application/json'}, body: JSON.stringify({
   attributes: { _ft_fbclid: ..., _ft_utm_source: ..., ... } }) })`. Map each
   cookie field to its `_ft_*` key. Fire it once per session.
3. Place an order through a fbclid/utm-tagged link; in Shopify admin open the
   order and confirm the `note_attributes` contain the `_ft_*` keys.

### Step B — usmile (Lovable headless) LAST: beacon + JOIN
usmile is headless (Lovable). The cart→order attribute SLA is unreliable
there, so use the existing `/api/events/cart` beacon pattern instead:
1. On the headless storefront, write the same write-once first-party cookie on
   first landing.
2. On add-to-cart, POST the `_ft_*` payload to `/api/events/cart` **keyed by
   the cart/checkout token** (the same key the existing add-to-cart beacon
   uses). Do NOT call any ad-platform SDK.
3. The dashboard JOINs the beacon's first-touch payload to the order at read
   time via the cart/checkout token. Until the JOIN is verified, treat
   usmile's first-click column as unverified.

### CAPI-safety gate (run BEFORE trusting a store's first-click numbers)
- [ ] Grep the installed snippet(s): **zero** `fbq`, `gtag`, `ttq`, `_fbq`,
      `snaptr`. Only `/cart/update.js` or `/api/events/cart` outbound.
- [ ] Meta Events Manager: NO new events after install (no new
      `Purchase`/`AddToCart` rows attributable to the snippet). Same check in
      Google Ads + TikTok Events Managers.
- [ ] Data-layer verify: on the storefront, confirm the `_ft_*` cart
      attributes are present (DevTools → Network → `/cart/update.js` payload,
      or the order's `note_attributes`). For usmile, confirm the
      `/api/events/cart` beacon carries the `_ft_*` payload + token.
- [ ] Confirm the CAPI app's `event_id` dedup is UNTOUCHED (we never write
      events).

### Caveats surfaced in the UI (do not re-litigate)
- **Google-blind:** first-click excludes Google (same as last-click).
- **Directional floor:** first-click coverage is always ≤ last-click because
  cookie/cart capture is lossier than the platform click-id.
- **ITP / ad-blocker / cross-device** gaps shrink coverage; treat first-click
  as directional, not authoritative.
- **usmile most fragile** — trust only after the data-layer `_ft_*` check.
````

- [ ] **Bump the User Manual version** — locate the current top-of-file version line (the manual tracks a "Version X.Y.Z" history; the latest is 2.17.0 per the COGS work) and add a new version entry, e.g. `### Version 2.18.0 (2026-06-02) — First-click lens (Phase 4) store-side capture install steps + CAPI-safety gate`. Match the existing version-entry format exactly.
- [ ] **Commit:**
```
git add docs/ROAS-Dashboard-User-Manual.md
git commit -m "$(cat <<'EOF'
docs(manual): first-click store-side capture install + CAPI-safety gate

Operator install steps (uzoshop+zolplus theme/pixel FIRST, usmile headless
beacon LAST), canonical _ft_* contract, and the CAPI-safety gate to run
before trusting a store's first-click numbers. UM 2.18.0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final gate — full suite + type-check

- [ ] **Run the full Node suite** — `npx vitest run`
- [ ] **Run the full DOM suite** — `npx vitest run --config vitest.config.dom.ts`
- [ ] **Type-check** — `npx tsc --noEmit`
- [ ] Confirm the mapping-preservation suites are green in the output: `campaignStoreMap*`, `tiktokFetcherStoreMapping`, `productCentricViewSumConservation`, `cannibalizationDetection`, `campaignProductMap`, `campaignsAggregator`, `orderSourceContract`.
- [ ] Do NOT push. Stop and report to the operator.

---

## Manual-verification checklist (operator, post-deploy + post-store-install)

1. **Migration applied:** `orders_attribution` has the 11 `first_*` columns (Supabase table editor); pre-migration rows show NULL (not `direct`).
2. **Dual-write live:** after the next `cronDaily` + `cronLive` ticks, recent `orders_attribution` rows for a store with the snippet installed have populated `first_*` columns; rows for not-yet-installed stores stay NULL.
3. **Reader:** the Campaigns tab + a campaign's AdsDrawer show a `first-click` column beside `ROAS Shopify`; value renders for Meta/TikTok campaigns with captured first-touch, `—` for Google.
4. **Delta:** hovering a first-click cell shows the first-click vs last-click breakdown and the signed delta (green up / red down / muted flat).
5. **Coverage chip:** the first-click coverage chip shows a sensible % (≤ last-click), quiet when healthy, warn when low; its title states the Google-blind + floor caveats.
6. **CAPI-safety:** for each installed store, the Phase-4 CAPI-safety gate (no `fbq/gtag/ttq`, no new Events-Manager events, `_ft_*` present in `note_attributes`) passes before the operator trusts the numbers. usmile verified LAST via the `/api/events/cart` JOIN.
7. **No regressions:** per-store Home cards + ROAS-band gradients unchanged; MER headline unchanged; mapping (incl. TikTok shared-account override) still routes per-store numbers correctly.

(Plan saved to `/Users/dorperetz/script-roas/docs/superpowers/plans/2026-06-02-plan-c-first-click-lens.md`.)