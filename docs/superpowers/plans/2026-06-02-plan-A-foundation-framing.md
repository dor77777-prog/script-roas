# Plan A — Foundation + Framing (Phases 0-2)

**Goal:** Clean up confirmed-dead code, install two regression guards that later plans depend on (dual-write key-set parity + reader SELECT-string presence), consolidate four duplicated inline `null-on-error` fetchers, fix four correctness/operator-unblock bugs (TikTok manual-override, hardcoded COGS/fee prose, leader-badge guard, mobile tooltip + logout), and re-frame the dashboard's headline numbers for trust (label hero ROAS → MER, demote per-platform ROAS to "directional", honest hero coverage % chip). Zero behavior change in Phase 0; all Phase 1/2 changes are display-only or pure-function and reversible. NEVER send/write events to ad platforms.

**Architecture:** Single-tier Next.js 14 (App Router) + Inngest crons + Supabase Postgres. The dashboard reads mapping-aware aggregates (`data_daily` via `agg_data_daily_for_date` + `lib/campaignStoreMap.ts`); per-store numbers never consume raw account totals. TikTok shares one ad account across stores with a per-campaign store override (default `uzoshop`). Manual operator spend overrides live in the `manual_overrides` table (PK `(date, store_id, platform)`), merged into per-store spend BEFORE persist by `lib/fetchers/manualOverrides.ts:mergeOverridesFromSupabase`, consumed by `cronDaily.ts`. The DB `manual_overrides_platform_check` CONSTRAINT **already allows `('meta','google','tiktok')`** (migration `20260522102151_add_tiktok_platform_check.sql`) — so unblocking TikTok requires **NO new migration**, only app-layer validator + UI + merge changes. Money/number UI renders through `<Money>`/`<Metric>` primitives + on-band/scrim tokens (2026-06-01 readability standard); icons are `lucide-react`.

**Tech Stack:** TypeScript, React 18, Next 14, SWR, Inngest, Supabase JS, Vitest (node + jsdom configs), Testing Library, Tailwind + CVA design tokens.

**For agentic workers:** Execute with `superpowers:subagent-driven-development`. Work one task at a time, top to bottom; each task is self-contained (write failing test → run & confirm FAIL → minimal impl → run & confirm PASS → commit). Do NOT push — pushing to `main` is a separate explicit operator step. All commands run with **cwd = `/Users/dorperetz/script-roas/dashboard-web`**. Node (pure) tests: `npx vitest run <path>`. DOM tests: `npx vitest run --config vitest.config.dom.ts <path>`. Type-check: `npx tsc --noEmit`. Conventional-commit messages; commit body ends with the Co-Authored-By trailer shown in each task.

---

## Files touched (map)

| Path | Phase / Task | Create / Modify | What |
|---|---|---|---|
| `src/lib/format.ts` | 0 / T1 | Modify | Delete `fmtMoneyBare`, `fmtNum2`, `fmtMoneyCompactTight`, `fmtDeltaPct`, `fmtDateShort` (zero importers) |
| `src/lib/costs.ts` | 0 / T1 | Modify | Delete `EMAIL_COST_PER_STORE_MONTHLY` (zero importers) |
| `src/lib/utils.ts` | 0 / T2 | Modify | Delete `formatPct` + `safeDecode` (+ its TODO comment); keep `cn`/`formatCurrency`/`formatNumber`/`formatDate` |
| `src/lib/__tests__/utils.test.ts` | 0 / T2 | Modify | Remove the `safeDecode` describe block (keep `formatCurrency` block) |
| `src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts` | 0 / T3 | Create | Guard: cronDaily + cronLive emit the SAME orders_attribution key set |
| `src/inngest/functions/cronDaily.ts` | 0 / T3 | Modify | Export a tiny pure `ordersAttributionRowKeys()` so the guard can read the canonical key set |
| `src/inngest/functions/cronLive.ts` | 0 / T3 | Modify | Reuse the exported `ordersAttributionRowKeys()` in its upsert map |
| `src/lib/__tests__/postgresReadersSelectStrings.test.ts` | 0 / T4 | Create | Guard: `orders_attribution` reader SELECT string lists every consumed column |
| `src/lib/postgresReaders.ts` | 0 / T4 | Modify | Export `ORDERS_ATTRIBUTION_SELECT` const; use it in `fetchOrdersAttributionFromPostgres` |
| `src/lib/fetchJson.ts` | 0 / T5 | Modify | Add `fetchJsonOrNull<T>(url)` (no-store; null on non-2xx) |
| `src/lib/__tests__/fetchJson.test.ts` | 0 / T5 | Modify | Add `fetchJsonOrNull` describe block |
| `src/components/AiReportButton.tsx` | 0 / T6 | Modify | Replace inline `fetcher` with `fetchJsonOrNull` |
| `src/components/SyncIndicator.tsx` | 0 / T6 | Modify | Replace inline `fetcher` with `fetchJsonOrNull` |
| `src/components/CommandPalette.tsx` | 0 / T6 | Modify | Replace inline `fetcher` with `fetchJsonOrNull` |
| `src/components/InsightsBoard.tsx` | 0 / T6 | Modify | Replace inline `fetcher` with `fetchJsonOrNull` |
| `src/lib/operatorManualOverrides.ts` | 1 / T7 | Modify | Add `tiktok` to `VALID_PLATFORMS`; update POST/PATCH error copy |
| `src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts` | 1 / T7 | Modify | Add tiktok-accept + error-copy assertions |
| `src/lib/fetchers/manualOverrides.ts` | 1 / T8 | Modify | Resolve a per-store TikTok override → `ttSpendCad` + `overridesApplied.tiktok` (mapping-aware via store_id key) |
| `src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts` | 1 / T8 | Create | Unit-test the TikTok merge branch |
| `src/inngest/functions/cronDaily.ts` | 1 / T9 | Modify | When a TikTok override exists for (store,date), use it as that store's `tt_spend_cad` |
| `src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts` | 1 / T9 | Create | Guard the cronDaily TikTok-override application point |
| `src/components/operator/ManualOverridesCrud.tsx` | 1 / T10 | Modify | Add `tiktok` to `ALL_PLATFORMS`; update the inline note |
| `src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx` | 1 / T10 | Create | Assert a TikTok `<option>` renders |
| `src/components/PnLBreakdown.tsx` | 1 / T11 | Modify | Replace hardcoded "COGS (25%)" prose with the actual effective rate; the fees rate already reads `TRANSACTION_FEES_RATE` |
| `src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx` | 1 / T11 | Create | Assert the warning prose shows the actual computed COGS % |
| `src/lib/aiReport.ts` | 1 / T12 | Modify | Add an explicit per-store COGS-rate disclosure line using `getCogsRateForStore` |
| `src/lib/__tests__/aiReportCogsRateDisclosure.test.ts` | 1 / T12 | Create | Assert the report names the actual per-store COGS rate |
| `src/lib/multiMappingCohort.ts` | 1 / T13 | Modify | Add display-only `leaderQualifies` (no trophy when leader < 2x); ranking math untouched |
| `src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts` | 1 / T13 | Create | Pin `leaderQualifies` semantics |
| `src/app/logout/LogoutButton.tsx` | 1 / T14 | Create | Logout button posting to `/api/logout` |
| `src/components/__tests__/logoutButton.dom.test.tsx` | 1 / T14 | Create | Assert button posts to `/api/logout` |
| `src/components/home/CommandCenterHero.tsx` | 2 / T15 | Modify | ROAS hero card label → "MER" + `title` tooltip; value/band/gradient unchanged |
| `src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx` | 2 / T15 | Create | Assert "MER" label + tooltip render; value unchanged |
| `src/components/CampaignsTable.tsx` | 2 / T16 | Modify | Demote per-platform ROAS header to stacked "ROAS · מכוון (directional)" |
| `src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx` | 2 / T16 | Create | Assert the directional sub-label renders |
| `src/components/AdsDrawer.tsx` | 2 / T17 | Modify | Demote per-platform ROAS column + totals to "directional / מכוון" |
| `src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx` | 2 / T17 | Create | Assert AdsDrawer directional label renders |
| `src/components/PnLBreakdown.tsx` | 2 / T18 | Modify | Ad-spend note "ROAS" → "MER" |
| `src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx` | 2 / T18 | Create | Assert the ad-spend note reads "MER" |
| `src/lib/home/adapters.ts` | 2 / T19 | Modify | Add `computeCoverage()` + `toCoverageChip()` from orders_attribution fields |
| `src/lib/home/__tests__/coverage.test.ts` | 2 / T19 | Create | Pin coverage math (channels + unknown = 100%, never redistributed) |
| `src/components/home/CoverageChip.tsx` | 2 / T20 | Create | Quiet hero-only coverage chip (`<Metric>` + tokens; prominent only > 30% unknown) |
| `src/components/home/__tests__/coverageChip.dom.test.tsx` | 2 / T20 | Create | Assert quiet vs prominent rendering |
| `src/components/home/CommandCenterHero.tsx` | 2 / T20 | Modify | Mount `<CoverageChip>` on the hero only (NOT per-store cards) |

---

## PHASE 0 — Housekeeping (zero-risk)

### Task 1 — Delete dead helpers in `format.ts` + `costs.ts`

**Files**
- Modify `src/lib/format.ts` (delete `fmtMoneyBare` ~L131, `fmtNum2` ~L138, `fmtMoneyCompactTight` ~L186, `fmtDeltaPct` ~L196, `fmtDateShort` ~L220)
- Modify `src/lib/costs.ts` (delete `EMAIL_COST_PER_STORE_MONTHLY` L40)
- Test: reuse `src/lib/__tests__/metricFormat.test.ts` (unaffected) + a one-off grep assertion via the existing suite

**Step 1 — confirm zero importers (must print nothing but the definition lines):**
```bash
grep -rn "fmtMoneyBare\|fmtNum2\|fmtMoneyCompactTight\|fmtDeltaPct\|fmtDateShort" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/format.ts:"
grep -rn "EMAIL_COST_PER_STORE_MONTHLY" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/costs.ts:"
```
Expected: **no output** for both (verified at plan-authoring time — only the definitions themselves exist).

**Step 2 — delete from `src/lib/format.ts`.** Remove exactly these blocks (the surrounding kept helpers — `fmtCount`, `fmtMoney`, `fmtMoneyString`, `fmtMoneyCompact`, `fmtPct`, `fmtDate` — stay):

Delete (with its doc comment):
```ts
/** Bare money without currency prefix. */
export function fmtMoneyBare(n: number, decimals: 0 | 2 = 0): React.ReactElement {
  const f = decimals === 0 ? MONEY : MONEY_2;
  return bdi(fixMinus(f.format(n)));
}

/** Format a 2-decimal number (e.g. ROAS 2.85). */
export function fmtNum2(n: number): React.ReactElement {
  return bdi(fixMinus(NUM_2.format(n)));
}
```
Delete (the entire `fmtMoneyCompactTight` block + its long doc comment):
```ts
export function fmtMoneyCompactTight(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs < 1_000) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }
  return `${sign}$${COMPACT_USD.format(abs)}`;
}
```
Delete (the `fmtDeltaPct` block + its doc comment):
```ts
/**
 * Format a delta percentage like "+12.4%" / "−3.4%". Always signed.
 * Returns a styled element so the call site can pick "good/bad" tone.
 */
export function fmtDeltaPct(value: number): React.ReactElement {
  return bdi(fixMinus(PCT_FORMATTER.format(value)));
}
```
Delete (the `fmtDateShort` block + its doc comment):
```ts
/** Shorter date for crowded cells: `DD/MM`. */
export function fmtDateShort(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : yyyymmdd;
}
```
After deletion, `NUM_2` and `PCT_FORMATTER` become unused module-scope formatters. Delete them too:
```ts
const PCT_FORMATTER = new Intl.NumberFormat('he-IL', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
```
(the `_SIGN_FORMATTER` was already dead-prefixed; leave it)
```ts
const NUM_2 = new Intl.NumberFormat('he-IL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
```
`MONEY_2` and `COMPACT_USD` are still used by `fmtMoney`/`fmtMoneyString`/`fmtMoneyCompact` — **keep them**.

**Step 3 — delete from `src/lib/costs.ts`.** Remove:
```ts
/** Email service (Klaviyo / similar) fixed monthly cost per store, in CAD. */
export const EMAIL_COST_PER_STORE_MONTHLY = 20;
```

**Step 4 — type-check (catches any unused-var or missed reference):**
```bash
npx tsc --noEmit
```
Expected: PASS (exit 0, no errors).

**Step 5 — run the format-adjacent suite to prove no regression:**
```bash
npx vitest run src/lib/__tests__/metricFormat.test.ts
```
Expected: PASS.

**Step 6 — commit:**
```bash
git add src/lib/format.ts src/lib/costs.ts
git commit -m "chore(dead-code): drop 6 zero-importer format/costs helpers

Removes fmtMoneyBare, fmtNum2, fmtMoneyCompactTight, fmtDeltaPct,
fmtDateShort (format.ts) + EMAIL_COST_PER_STORE_MONTHLY (costs.ts).
grep confirmed zero call sites; tsc + metricFormat suite green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 — Delete dead helpers in `utils.ts` + prune their test block

**Files**
- Modify `src/lib/utils.ts` (delete `formatPct` L44, `safeDecode` L74 + its `TODO(phase-5)` comment block ~L53)
- Modify `src/lib/__tests__/utils.test.ts` (remove the `safeDecode` describe block)

**Step 1 — confirm zero importers:**
```bash
grep -rn "\bformatPct\b" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/utils.ts:"
grep -rn "safeDecode" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/fetchers/shopify.ts:" | grep -v "src/lib/utils.ts:" | grep -v "src/lib/__tests__/utils.test.ts:"
```
Expected: **no output**. (Note: `src/lib/fetchers/shopify.ts` defines and uses its OWN local `safeDecode` — unrelated; it is NOT touched.)

**Step 2 — write the test change FIRST (red).** In `src/lib/__tests__/utils.test.ts`:
- Change the import line from
  ```ts
  import { formatCurrency, safeDecode } from '@/lib/utils';
  ```
  to
  ```ts
  import { formatCurrency } from '@/lib/utils';
  ```
- Delete the entire `describe('safeDecode', () => { ... });` block (the first describe, ~8 `it`s). Keep the `describe('formatCurrency', ...)` block and its leading doc comment intact.

**Step 3 — run (expect FAIL, because `safeDecode` no longer imported but still exported makes tsc-via-vitest tolerant; the real red is the next impl step). Run to confirm the file still parses:**
```bash
npx vitest run src/lib/__tests__/utils.test.ts
```
Expected: PASS for the remaining `formatCurrency` tests (this step proves the prune didn't break the kept block).

**Step 4 — delete from `src/lib/utils.ts`.** Remove:
```ts
export function formatPct(n: number, sign = false): string {
  const fmt = new Intl.NumberFormat('he-IL', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
  return sign && n > 0 ? '+' + fmt : fmt;
}
```
And remove the `safeDecode` function PLUS its preceding `// TODO(phase-5): ...` comment and the `/** Try/catch wrapper ... */` doc comment — the whole block from the `// TODO(phase-5)` line through the closing brace of `safeDecode`:
```ts
// TODO(phase-5): wire safeDecode() into useSearchParams() consumers for UTM
// param surfaces (CampaignDrawer URL params, future deep-link routes,
// landing-URL manual-spend rows). Until then this is preemptive infrastructure
// — keep the tests green so the contract doesn't drift before the first
// caller arrives. (IN-07)
/**
 * Try/catch wrapper around `decodeURIComponent`. ...
 */
export function safeDecode(value: string | null | undefined): string {
  if (value == null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
```
Keep `cn`, `formatCurrency`, `formatNumber`, `formatDate`.

**Step 5 — type-check + run the pruned test:**
```bash
npx tsc --noEmit
npx vitest run src/lib/__tests__/utils.test.ts
```
Expected: tsc PASS; tests PASS (only `formatCurrency` block remains).

**Step 6 — commit:**
```bash
git add src/lib/utils.ts src/lib/__tests__/utils.test.ts
git commit -m "chore(dead-code): drop utils.formatPct + safeDecode (zero importers)

safeDecode was preemptive phase-5 infra never wired up; formatPct
unused. Removes both + the safeDecode test block (shopify.ts keeps its
own unrelated local copy). formatCurrency tests retained.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 — Guard: cronDaily + cronLive emit the SAME orders_attribution key set

**Files**
- Modify `src/inngest/functions/cronDaily.ts` (export a pure `ordersAttributionRowKeys()`; use it in the upsert map at ~L1418)
- Modify `src/inngest/functions/cronLive.ts` (use the same helper in its upsert map at ~L682)
- Test: Create `src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts`

**Step 1 — write the failing test** `src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ordersAttributionRowKeys } from '@/inngest/functions/cronDaily';

// Phase 0 (2026-06-02) — dual-write drift guard. cronDaily and cronLive
// both UPSERT into orders_attribution; if their column sets ever diverge,
// one path silently drops a field (e.g. a new attribution column added to
// only one writer). We pin a single canonical key set both maps consume.
//
// The cronLive upsert map is built from the SAME exported helper, so this
// test reading the helper once is sufficient: the source contract is that
// neither writer hand-rolls its own object literal.
describe('orders_attribution dual-write key parity', () => {
  it('exposes the exact canonical column set written to orders_attribution', () => {
    expect(ordersAttributionRowKeys().sort()).toEqual(
      [
        'store_id',
        'order_id',
        'date',
        'total_cad',
        'source',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'fbclid_present',
        'gclid_present',
        'referrer',
        'utm_id',
        'utm_term',
        'line_items',
      ].sort(),
    );
  });

  it('cronLive imports and reuses the same helper (no independent literal)', async () => {
    // Static guarantee: cronLive must import the helper. We assert the
    // module source references it so a future hand-rolled literal regresses.
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../cronLive.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/ordersAttributionRowKeys/);
  });
});
```

**Step 2 — run (expect FAIL — helper not exported yet):**
```bash
npx vitest run src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts
```
Expected: FAIL — `ordersAttributionRowKeys is not a function` / import error.

**Step 3 — minimal impl in `src/inngest/functions/cronDaily.ts`.** Add near the top (after imports), a pure exported builder + the canonical key list:
```ts
/**
 * Phase 0 (2026-06-02) — single source of truth for the orders_attribution
 * UPSERT column shape. cronDaily AND cronLive both build their upsert rows
 * from this mapper so a new attribution field can't be added to one writer
 * and silently dropped by the other. `ordersAttributionRowKeys()` is the
 * dual-write parity guard's read surface.
 */
export type OrderAttributionUpsertRow = {
  store_id: string;
  order_id: string;
  date: string;
  total_cad: number;
  source: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  fbclid_present: boolean;
  gclid_present: boolean;
  referrer: string;
  utm_id: string;
  utm_term: string;
  line_items: unknown;
};

export function toOrdersAttributionRow(o: {
  storeId: string;
  orderId: string;
  date: string;
  totalCad: number;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string;
  utmId: string;
  utmTerm: string;
  lineItems: unknown;
}): OrderAttributionUpsertRow {
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
  };
}

export function ordersAttributionRowKeys(): string[] {
  return Object.keys(
    toOrdersAttributionRow({
      storeId: '',
      orderId: '',
      date: '',
      totalCad: 0,
      source: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmContent: '',
      fbclidPresent: false,
      gclidPresent: false,
      referrer: '',
      utmId: '',
      utmTerm: '',
      lineItems: [],
    }),
  );
}
```
Then replace the inline upsert map at ~L1419 (`const orderRows = shopify.orders.map((o) => ({ store_id: o.storeId, ... line_items: o.lineItems, }));`) with:
```ts
      const orderRows = shopify.orders.map((o) => toOrdersAttributionRow(o));
```

**Step 4 — reuse in `src/inngest/functions/cronLive.ts`.** Add to its imports:
```ts
import { toOrdersAttributionRow } from '@/inngest/functions/cronDaily';
```
Replace its inline upsert map at ~L682 (`const orderRows = todayOrders.map((o) => ({ store_id: o.storeId, ... }));`) with:
```ts
      const orderRows = todayOrders.map((o) => toOrdersAttributionRow(o));
```
(The cronLive `todayOrders` element shape matches `cronDaily`'s `shopify.orders` element shape — both are the same `OrderAttribution` fetcher output. If tsc surfaces a field-name mismatch, the helper's parameter type is the contract; align the call, not the helper.)

**Step 5 — run (expect PASS) + type-check:**
```bash
npx vitest run src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts
npx tsc --noEmit
```
Expected: tests PASS; tsc PASS.

**Step 6 — run the existing cron suites to prove no regression:**
```bash
npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts src/inngest/functions/__tests__/cronLive.test.ts
```
Expected: PASS.

**Step 7 — commit:**
```bash
git add src/inngest/functions/cronDaily.ts src/inngest/functions/cronLive.ts src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts
git commit -m "test(orders-attribution): dual-write key-set parity guard

Extracts toOrdersAttributionRow() in cronDaily as the single column-shape
source; cronLive reuses it. New guard pins the 15-key canonical set so a
field added to one writer can't be silently dropped by the other.
Prereq for P3/P4 (customer_id/order_created_at columns).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4 — Guard: orders_attribution reader SELECT-string presence

**Files**
- Modify `src/lib/postgresReaders.ts` (export `ORDERS_ATTRIBUTION_SELECT`; use it in `fetchOrdersAttributionFromPostgres` ~L1051)
- Test: Create `src/lib/__tests__/postgresReadersSelectStrings.test.ts`

**Step 1 — write the failing test** `src/lib/__tests__/postgresReadersSelectStrings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ORDERS_ATTRIBUTION_SELECT } from '@/lib/postgresReaders';

// Phase 0 (2026-06-02) — reader SELECT-string presence guard. The
// orders_attribution reader builds its column list as a hand-written
// string; a typo or a column dropped from the SELECT silently returns
// `undefined` for that field downstream. We pin every consumed column.
// Prereq for P3 (reading customer_id / order_created_at back).
describe('postgresReaders SELECT strings', () => {
  it('orders_attribution SELECT lists every consumed column', () => {
    for (const col of [
      'date',
      'store_id',
      'order_id',
      'total_cad',
      'source',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'fbclid_present',
      'gclid_present',
      'referrer',
      'utm_id',
      'utm_term',
      'line_items',
    ]) {
      expect(ORDERS_ATTRIBUTION_SELECT).toContain(col);
    }
  });
});
```

**Step 2 — run (expect FAIL — const not exported yet):**
```bash
npx vitest run src/lib/__tests__/postgresReadersSelectStrings.test.ts
```
Expected: FAIL — `ORDERS_ATTRIBUTION_SELECT` is undefined.

**Step 3 — minimal impl in `src/lib/postgresReaders.ts`.** Add near the top-level consts:
```ts
/**
 * Phase 0 (2026-06-02) — canonical orders_attribution SELECT column list.
 * Exported so a presence test can assert every downstream-consumed column
 * is actually requested (a dropped column otherwise reads back undefined).
 */
export const ORDERS_ATTRIBUTION_SELECT =
  'date, store_id, order_id, total_cad, source, utm_source, utm_medium, ' +
  'utm_campaign, utm_content, fbclid_present, gclid_present, referrer, ' +
  'utm_id, utm_term, line_items';
```
Then in `fetchOrdersAttributionFromPostgres` (~L1051) replace the inline `.select('date, store_id, order_id, total_cad, ...' + ... )` argument with:
```ts
        .select(ORDERS_ATTRIBUTION_SELECT)
```

**Step 4 — run (expect PASS) + type-check + existing reader tests:**
```bash
npx vitest run src/lib/__tests__/postgresReadersSelectStrings.test.ts
npx tsc --noEmit
```
Expected: tests PASS; tsc PASS.

**Step 5 — commit:**
```bash
git add src/lib/postgresReaders.ts src/lib/__tests__/postgresReadersSelectStrings.test.ts
git commit -m "test(postgresReaders): orders_attribution SELECT-string presence guard

Exports ORDERS_ATTRIBUTION_SELECT as the single column list and pins all
15 consumed columns. Prereq for P3 reading customer_id/order_created_at.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 — Add `fetchJsonOrNull` to `lib/fetchJson.ts`

**Files**
- Modify `src/lib/fetchJson.ts` (add `fetchJsonOrNull<T>(url)`)
- Modify `src/lib/__tests__/fetchJson.test.ts` (add describe block)

**Step 1 — write the failing test.** Append to `src/lib/__tests__/fetchJson.test.ts` (after the existing `describe('fetchJson', ...)`):
```ts
import { fetchJsonOrNull } from '@/lib/fetchJson';

describe('fetchJsonOrNull', () => {
  it("requests with cache: 'no-store'", async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }));
    vi.stubGlobal('fetch', spy);
    await fetchJsonOrNull('/api/data');
    expect(spy).toHaveBeenCalledWith('/api/data', { cache: 'no-store' });
  });

  it('returns the parsed JSON on a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ v: 42 }) })));
    const result = await fetchJsonOrNull<{ v: number }>('/api/data');
    expect(result).toEqual({ v: 42 });
  });

  it('returns null on a non-ok response (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const result = await fetchJsonOrNull('/api/data');
    expect(result).toBeNull();
  });

  it('returns null when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await fetchJsonOrNull('/api/data');
    expect(result).toBeNull();
  });
});
```
(Move the new `import { fetchJsonOrNull } ...` up next to the existing `import { fetchJson }` line if your linter prefers grouped imports; either placement runs.)

**Step 2 — run (expect FAIL — `fetchJsonOrNull` not exported):**
```bash
npx vitest run src/lib/__tests__/fetchJson.test.ts
```
Expected: FAIL on the new block (import error / not a function).

**Step 3 — minimal impl.** Append to `src/lib/fetchJson.ts`:
```ts
/**
 * Soft sibling of {@link fetchJson} for SWR fetchers that prefer a `null`
 * datum over a thrown error (the "stay rendered, just show no data" path).
 * Consolidates the four identical inline
 * `(url) => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)`
 * fetchers (AiReportButton, SyncIndicator, CommandPalette, InsightsBoard).
 *
 * Returns the parsed body on 2xx; `null` on any non-2xx OR on a thrown
 * network error. Same `no-store` browser-cache semantics as `fetchJson`.
 */
export async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

**Step 4 — run (expect PASS) + type-check:**
```bash
npx vitest run src/lib/__tests__/fetchJson.test.ts
npx tsc --noEmit
```
Expected: PASS.

**Step 5 — commit:**
```bash
git add src/lib/fetchJson.ts src/lib/__tests__/fetchJson.test.ts
git commit -m "feat(fetchJson): add fetchJsonOrNull soft-fail fetcher

null-on-non-2xx / null-on-network-error sibling of fetchJson, with the
same no-store browser cache semantics. Consolidation target for the four
duplicated inline SWR fetchers (next task).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6 — Consolidate the 4 inline `null-on-error` fetchers

**Files**
- Modify `src/components/AiReportButton.tsx` (replace inline `fetcher` L19)
- Modify `src/components/SyncIndicator.tsx` (replace inline `fetcher` L27)
- Modify `src/components/CommandPalette.tsx` (replace inline `fetcher` L67)
- Modify `src/components/InsightsBoard.tsx` (replace inline `fetcher` L44)
- No new test file (behavior covered by Task 5 + tsc); existing component DOM tests guard regressions

**Step 1 — `src/components/AiReportButton.tsx`.** Add to the import block (after L16 `import { buildDateRangeKey } ...`):
```ts
import { fetchJsonOrNull } from '@/lib/fetchJson';
```
Delete L19:
```ts
const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
```
Replace every `useSWR<...>(key, fetcher, ...)` call's `fetcher` argument with `fetchJsonOrNull`. The four SWR hooks at L65-74 become e.g.:
```ts
  const { data: products } = useSWR<ProductsResponse | null>(productsKey, fetchJsonOrNull, {
```
(repeat for campaigns/orders/ads — only the 2nd arg changes).

**Step 2 — `src/components/SyncIndicator.tsx`.** Add import:
```ts
import { fetchJsonOrNull } from '@/lib/fetchJson';
```
Delete L27 inline `fetcher`. Change the `useSWR<HealthResponse | null>(...)` call (L38) to pass `fetchJsonOrNull` as the fetcher arg.

**Step 3 — `src/components/CommandPalette.tsx`.** Add import (next to L34 `import { cn } from '@/lib/utils';`):
```ts
import { fetchJsonOrNull } from '@/lib/fetchJson';
```
Delete L67 inline `fetcher`. Change the two `useSWR<...>(warmCache ? ... : null, fetcher, ...)` calls (L118, L123) to pass `fetchJsonOrNull`.

**Step 4 — `src/components/InsightsBoard.tsx`.** Add import (next to L34 `import { cn } from '@/lib/utils';`):
```ts
import { fetchJsonOrNull } from '@/lib/fetchJson';
```
Delete L44 inline `fetcher`. Change the two `useSWR<...>(..., fetcher, ...)` calls (L108, L112) to pass `fetchJsonOrNull`.

**Step 5 — confirm no orphan `fetcher` references remain:**
```bash
grep -rn "const fetcher = (url: string) => fetch(url, { cache: 'no-store' })" src/components/AiReportButton.tsx src/components/SyncIndicator.tsx src/components/CommandPalette.tsx src/components/InsightsBoard.tsx
grep -rn "\bfetcher\b" src/components/AiReportButton.tsx src/components/SyncIndicator.tsx src/components/CommandPalette.tsx src/components/InsightsBoard.tsx
```
Expected: first grep prints nothing; second prints nothing (every `fetcher` usage replaced). If the second still shows a `fetcher` token, replace that occurrence too.

**Step 6 — type-check + run existing component DOM tests touching these (regression):**
```bash
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/__tests__
```
Expected: tsc PASS; DOM suite PASS (no behavior change — `fetchJsonOrNull` returns the same `T | null` the inline fetchers did).

**Step 7 — commit:**
```bash
git add src/components/AiReportButton.tsx src/components/SyncIndicator.tsx src/components/CommandPalette.tsx src/components/InsightsBoard.tsx
git commit -m "refactor(swr): use fetchJsonOrNull in the 4 null-on-error fetchers

Replaces the duplicated inline
(url)=>fetch(url,{cache:'no-store'}).then(r=>r.ok?r.json():null)
in AiReportButton/SyncIndicator/CommandPalette/InsightsBoard with the
shared lib helper. Identical runtime behavior; one source of truth.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## PHASE 1 — Correctness & operator-unblock fixes

### Task 7 — Unblock TikTok in the manual-override validator + error copy

**Files**
- Modify `src/lib/operatorManualOverrides.ts` (L19 `VALID_PLATFORMS`; POST error copy in `validatePost`; the PATCH error copy lives in `route.ts` — updated here for the message string only via the shared error text)
- Modify `src/app/api/operator/manual-overrides/route.ts` (PATCH platform error message)
- Modify `src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts` (add tiktok-accept assertions)

**Step 1 — write failing tests.** Append to `src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts` inside a new describe (after the existing describes):
```ts
import { VALID_PLATFORMS } from '@/lib/operatorManualOverrides';

describe('manual-overrides TikTok unblock (2026-06-02)', () => {
  it('VALID_PLATFORMS includes tiktok (DB CHECK already allows it)', () => {
    expect(VALID_PLATFORMS.has('tiktok')).toBe(true);
    expect(VALID_PLATFORMS.has('meta')).toBe(true);
    expect(VALID_PLATFORMS.has('google')).toBe(true);
  });

  it("validatePost accepts platform='tiktok'", () => {
    const result = validatePost({
      date: '2026-05-20',
      store_id: 'uzoshop',
      platform: 'tiktok',
      spend: 1500,
      currency: 'USD',
      notes: 'tiktok account outage backfill',
    });
    expect(typeof result).toBe('object');
    expect((result as { platform: string }).platform).toBe('tiktok');
  });

  it('rejects an unknown platform with the 3-value error copy', () => {
    const result = validatePost({
      date: '2026-05-20',
      store_id: 'uzoshop',
      platform: 'snapchat',
      spend: 10,
      currency: 'USD',
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/meta.*google.*tiktok|tiktok/i);
  });
});
```

**Step 2 — run (expect FAIL):**
```bash
npx vitest run src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts
```
Expected: FAIL — `VALID_PLATFORMS.has('tiktok')` is false; tiktok validatePost returns the old error string.

**Step 3 — minimal impl in `src/lib/operatorManualOverrides.ts`.** Change L19:
```ts
export const VALID_PLATFORMS = new Set(['meta', 'google', 'tiktok']);
```
In `validatePost`, change the platform error string from
```ts
    return "platform must be 'meta' or 'google'";
```
to
```ts
    return "platform must be 'meta', 'google', or 'tiktok'";
```

**Step 4 — update PATCH error copy in `src/app/api/operator/manual-overrides/route.ts`.** Change:
```ts
        return NextResponse.json({ error: "platform must be 'meta' or 'google'" }, { status: 400 });
```
to
```ts
        return NextResponse.json({ error: "platform must be 'meta', 'google', or 'tiktok'" }, { status: 400 });
```

**Step 5 — run (expect PASS) + type-check + the existing strict-spend regressions stay green:**
```bash
npx vitest run src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts
npx tsc --noEmit
```
Expected: PASS (including all pre-existing meta/google strict-numeric tests).

**Step 6 — commit:**
```bash
git add src/lib/operatorManualOverrides.ts src/app/api/operator/manual-overrides/route.ts src/lib/__tests__/operatorManualOverridesSpendStrict.test.ts
git commit -m "fix(operator): unblock tiktok in manual-override validator + error copy

DB manual_overrides_platform_check already allows tiktok (migration
20260522102151); only the app-layer validator still rejected it. Adds
tiktok to VALID_PLATFORMS + 3-value error copy in POST and PATCH.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8 — Mapping-aware TikTok branch in `mergeOverridesFromSupabase`

**Files**
- Modify `src/lib/fetchers/manualOverrides.ts` (add `tiktokSpend` input + `ttSpendCad` output + `overridesApplied.tiktok`; the override is keyed by `store_id`, which IS the mapped store — never the raw shared account, never another store)
- Test: Create `src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts`

**Design note (mapping-awareness):** The `manual_overrides` row is keyed by `(date, store_id, platform)`. Because the override is resolved per `store_id`, a `uzoshop` TikTok override only ever replaces `uzoshop`'s TikTok spend — never the raw shared-account total and never `usmile360`'s mapped share. This keeps the override on the SAME per-store axis the agg uses. We do NOT touch `lib/campaignStoreMap.ts`, the fetcher, or the agg RPC, so all mapping suites stay green.

**Step 1 — write failing test** `src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the FX layer so the merge is deterministic (USD→CAD = 1.4).
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => 1.4),
}));

// Mock the supabase admin client so the override lookup returns canned rows.
let cannedRows: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: cannedRows, error: null }),
        }),
      }),
    }),
  }),
}));

import { mergeOverridesFromSupabase } from '@/lib/fetchers/manualOverrides';

beforeEach(() => {
  cannedRows = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeOverridesFromSupabase — TikTok branch (2026-06-02)', () => {
  it('passes through the fetched tt spend (CAD) when no tiktok override exists', async () => {
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 100, currency: 'CAD' },
    });
    expect(r.ttSpendCad).toBe(100);
    expect(r.overridesApplied.tiktok).toBe(false);
  });

  it('REPLACES tt spend with the override (USD→CAD) for the keyed store only', async () => {
    cannedRows = [{ date: '2026-05-20', store_id: 'uzoshop', platform: 'tiktok', spend: 200, currency: 'USD' }];
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 999, currency: 'CAD' }, // ignored — overridden
    });
    expect(r.ttSpendCad).toBe(280); // 200 USD * 1.4
    expect(r.overridesApplied.tiktok).toBe(true);
  });

  it('totalSpendCad includes the tiktok override', async () => {
    cannedRows = [{ date: '2026-05-20', store_id: 'uzoshop', platform: 'tiktok', spend: 100, currency: 'CAD' }];
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 50, currency: 'CAD' },
      googleSpend: { spend: 25, currency: 'CAD' },
      tiktokSpend: { spend: 0, currency: 'CAD' },
    });
    expect(r.totalSpendCad).toBe(175); // 50 + 25 + 100
  });

  it('tiktokSpend is optional — omitting it yields ttSpendCad 0', async () => {
    const r = await mergeOverridesFromSupabase({
      storeId: 'zolplus',
      date: '2026-05-20',
      metaSpend: { spend: 10, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
    });
    expect(r.ttSpendCad).toBe(0);
    expect(r.overridesApplied.tiktok).toBe(false);
    expect(r.totalSpendCad).toBe(10);
  });
});
```

**Step 2 — run (expect FAIL — `tiktokSpend`/`ttSpendCad`/`overridesApplied.tiktok` don't exist):**
```bash
npx vitest run src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts
```
Expected: FAIL.

**Step 3 — minimal impl in `src/lib/fetchers/manualOverrides.ts`.** Extend the types + merge:
```ts
export type MergeInput = {
  storeId: string;
  date: string; // YYYY-MM-DD
  metaSpend: SpendInput;
  googleSpend: SpendInput;
  /** Mapping-resolved TikTok spend for THIS store (already split per store
   *  by the fetcher/agg). Optional: omitted for non-TikTok stores → 0. */
  tiktokSpend?: SpendInput;
};

export type MergeResult = {
  fbSpendCad: number;
  gaSpendCad: number;
  ttSpendCad: number;
  totalSpendCad: number;
  overridesApplied: { meta: boolean; google: boolean; tiktok: boolean };
};
```
In `mergeOverridesFromSupabase`, after the Google resolution and BEFORE the defensive loop, add the TikTok branch and widen `overridesApplied`:
```ts
  const overridesApplied = { meta: false, google: false, tiktok: false };
```
```ts
  let ttSpendCad: number;
  const tiktokRow = rows.find((r) => r.platform === 'tiktok');
  if (tiktokRow) {
    // Mapping-aware: the row is keyed by store_id, so this replaces ONLY
    // this store's mapped TikTok spend — never the raw shared account,
    // never another store's split.
    ttSpendCad = await overrideToCad(tiktokRow, date);
    overridesApplied.tiktok = true;
  } else {
    ttSpendCad = input.tiktokSpend
      ? await spendToCad(input.tiktokSpend, date)
      : 0;
  }
```
Update the defensive unexpected-platform loop to allow `tiktok`:
```ts
    if (r.platform !== 'meta' && r.platform !== 'google' && r.platform !== 'tiktok') {
```
Update the `OverrideRow` doc comment `platform: string; // CHECK-constrained to 'meta' | 'google' | 'tiktok' at the DB`. And the return:
```ts
  const totalSpendCad = fbSpendCad + gaSpendCad + ttSpendCad;
  return { fbSpendCad, gaSpendCad, ttSpendCad, totalSpendCad, overridesApplied };
```

**Step 4 — run (expect PASS) + type-check:**
```bash
npx vitest run src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts
npx tsc --noEmit
```
Expected: tests PASS. tsc may surface that `cronDaily.ts` reads `merged.totalSpendCad` (still fine — it now includes tt only when a tt override exists; cronDaily's own tt path is reconciled in Task 9). If tsc errors on a now-required field, it is the `cronDaily` call site that needs Task 9; complete Task 9 before final tsc-green. For THIS task, ensure the test file + `manualOverrides.ts` compile in isolation:
```bash
npx vitest run src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts
```
Expected: PASS.

**Step 5 — run mapping suites to prove they stay green (this task touches neither the map nor the fetcher):**
```bash
npx vitest run src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
```
Expected: PASS.

**Step 6 — commit:**
```bash
git add src/lib/fetchers/manualOverrides.ts src/lib/fetchers/__tests__/mergeOverridesTikTok.test.ts
git commit -m "feat(overrides): mapping-aware TikTok branch in mergeOverridesFromSupabase

Adds optional tiktokSpend input + ttSpendCad/overridesApplied.tiktok
output. The override is keyed by store_id (the mapped store), so it
replaces only that store's TikTok share — never the raw shared account
or another store. Map + fetcher untouched; tiktokFetcherStoreMapping
green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9 — Apply the TikTok override at cronDaily's per-store `tt_spend_cad`

**Files**
- Modify `src/inngest/functions/cronDaily.ts` (feed `tiktokSpend` into the merge; when `overridesApplied.tiktok`, use `merged.ttSpendCad` as the persisted `tt_spend_cad` instead of the fetched value)
- Test: Create `src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts` (pure-function guard on the chosen tt value)

**Design note:** The `agg_tiktok_spend_per_store_for_date` RPC re-derives per-store TikTok spend from `campaigns_daily` AFTER persist for the *non-override* case. To keep the override authoritative we extract a tiny pure helper `chooseTikTokSpendCad()` and unit-test it, rather than threading a full cron integration test. The merge result (`overridesApplied.tiktok`) decides which value wins; when an override exists, the operator's typed value is the per-store truth and must not be silently re-derived. (Operationally, the agg only runs in the TikTok-store branch; when a manual override is present the operator is correcting an account outage where campaigns_daily is empty/wrong — so the override is the correct source.)

**Step 1 — write failing test** `src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chooseTikTokSpendCad } from '@/inngest/functions/cronDaily';

// Phase 1 (2026-06-02) — when an operator TikTok manual-override exists for
// (store, date), it is the authoritative per-store tt_spend_cad. Otherwise
// the fetched/FX'd value stands and the agg RPC may re-derive it later.
describe('chooseTikTokSpendCad', () => {
  it('uses the override value when overridesApplied.tiktok is true', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: true, overrideCad: 280, fetchedCad: 999 }),
    ).toBe(280);
  });

  it('uses the fetched value when no override applied', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: false, overrideCad: 0, fetchedCad: 100 }),
    ).toBe(100);
  });

  it('passes through null fetched (FX failure) when no override', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: false, overrideCad: 0, fetchedCad: null }),
    ).toBeNull();
  });

  it('override wins even when fetched is null (operator value is authoritative)', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: true, overrideCad: 140, fetchedCad: null }),
    ).toBe(140);
  });
});
```

**Step 2 — run (expect FAIL — helper not exported):**
```bash
npx vitest run src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts
```
Expected: FAIL.

**Step 3 — minimal impl in `src/inngest/functions/cronDaily.ts`.** Add the pure helper near `toOrdersAttributionRow`:
```ts
/**
 * Phase 1 (2026-06-02) — pick the authoritative per-store TikTok CAD spend.
 * A present manual override (keyed by store_id → mapping-aware) wins over the
 * fetched/FX'd value, even when the fetched value is null (FX failure):
 * the operator typed the override precisely because the fetched data was
 * wrong (e.g. account outage). With no override, the fetched value (which may
 * be null to preserve the prior row) stands.
 */
export function chooseTikTokSpendCad(args: {
  overrideApplied: boolean;
  overrideCad: number;
  fetchedCad: number | null;
}): number | null {
  return args.overrideApplied ? args.overrideCad : args.fetchedCad;
}
```
Feed TikTok into the merge call (~L587). Change:
```ts
    mergeOverridesFromSupabase({
      storeId,
      date: dateStr,
      metaSpend: meta.spend, // { spend, currency:'ILS' }
      googleSpend: google.spend, // { spend, currency:'CAD' } or zero
    }),
```
to:
```ts
    mergeOverridesFromSupabase({
      storeId,
      date: dateStr,
      metaSpend: meta.spend, // { spend, currency:'ILS' }
      googleSpend: google.spend, // { spend, currency:'CAD' } or zero
      tiktokSpend: tiktok.spend, // { spend, currency:'USD' } or zero
    }),
```
Then in `persist-batch`, after the existing `let ttSpendCad: number | null = null; ... } else { ttSpendCad = 0; }` block (ends ~L653), reconcile with the override:
```ts
    // Phase 1 (2026-06-02): a per-store TikTok manual override (mapping-aware,
    // keyed by store_id) is authoritative — it replaces the fetched/FX'd
    // value here so the operator's correction survives the persist.
    ttSpendCad = chooseTikTokSpendCad({
      overrideApplied: merged.overridesApplied.tiktok,
      overrideCad: merged.ttSpendCad,
      fetchedCad: ttSpendCad,
    });
```
Because `merged.totalSpendCad` now already includes the tt override, the existing `totalSpendCadAll = ttSpendCad === null ? null : merged.totalSpendCad + ttSpendCad;` would double-count when an override applies. Fix the total to use only the fb+ga portion plus the chosen tt:
```ts
    const totalSpendCadAll =
      ttSpendCad === null
        ? null
        : merged.fbSpendCad + merged.gaSpendCad + ttSpendCad;
```

**Step 4 — run (expect PASS) + type-check + existing cron suites:**
```bash
npx vitest run src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts
npx tsc --noEmit
npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts src/inngest/functions/__tests__/cronDailyFxFailure.test.ts src/inngest/functions/__tests__/cronDailyReturnRoasEquivalence.test.ts
```
Expected: all PASS. (The fb+ga+tt total equals the prior behavior for the no-override case because `merged.ttSpendCad` is 0 and `ttSpendCad` falls through to the fetched value.)

**Step 5 — commit:**
```bash
git add src/inngest/functions/cronDaily.ts src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts
git commit -m "fix(cron-daily): apply mapping-aware TikTok override as authoritative tt_spend

Threads tiktok.spend into mergeOverridesFromSupabase and uses
chooseTikTokSpendCad so a per-store TikTok manual override wins over the
fetched/FX'd value (even on FX failure). Total recomputed from
fb+ga+chosen-tt to avoid double-counting the merged tt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10 — TikTok option in the operator manual-overrides UI

**Files**
- Modify `src/components/operator/ManualOverridesCrud.tsx` (L80 `ALL_PLATFORMS`; the inline "TikTok cannot be corrected here" note ~L423)
- Test: Create `src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx`

**Step 1 — write failing DOM test** `src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';

// operatorFetch hits the network; stub it so the component renders the form
// without a live request. The platform <select> options are static, so an
// empty list response is enough to mount the form.
vi.mock('@/lib/operatorFetch', () => ({
  operatorFetch: vi.fn(async () => ({
    json: async () => ({ rows: [] }),
    status: 200,
  })),
}));

afterEach(() => cleanup());

describe('ManualOverridesCrud platform <select> (2026-06-02)', () => {
  it('renders a tiktok option alongside meta and google', () => {
    const { container } = render(<ManualOverridesCrud />);
    const values = Array.from(container.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toContain('meta');
    expect(values).toContain('google');
    expect(values).toContain('tiktok');
  });
});
```
(Confirm the actual operatorFetch import path in `ManualOverridesCrud.tsx` and mock that exact module specifier; adjust the `vi.mock` path if it differs from `@/lib/operatorFetch`.)

**Step 2 — run (expect FAIL — no tiktok option):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx
```
Expected: FAIL.

**Step 3 — minimal impl in `src/components/operator/ManualOverridesCrud.tsx`.** Change L80:
```ts
const ALL_PLATFORMS = ['meta', 'google', 'tiktok'] as const;
```
Update the inline note (~L423) that says TikTok spend cannot be corrected — replace the "TikTok spend cannot be corrected here" sentence with copy that reflects the new capability and the mapping semantics, e.g.:
```tsx
          A TikTok override applies to the selected store's mapped campaigns
          only (the shared account is split per the campaign↔store map) — it
          does not touch the raw shared-account total or the other stores.
```
(Preserve the surrounding markup; only swap the now-stale sentence.)

**Step 4 — run (expect PASS) + type-check:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx
npx tsc --noEmit
```
Expected: PASS.

**Step 5 — commit:**
```bash
git add src/components/operator/ManualOverridesCrud.tsx src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx
git commit -m "feat(operator-ui): add TikTok option to manual-overrides editor

ALL_PLATFORMS now meta/google/tiktok (matches the unblocked validator +
the DB CHECK). Inline note updated to explain the override is mapping-
aware (per-store mapped campaigns, not the raw shared account).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11 — Replace hardcoded "COGS (25%)" prose in PnLBreakdown with the actual rate

**Files**
- Modify `src/components/PnLBreakdown.tsx` (the "טרם הוגדרו עלויות" warning prose at L224)
- Test: Create `src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx`

**Design note:** `current.cogs` already reflects the effective per-store/per-month rate (the client recompute via `applyCogsToRows` runs upstream of the Aggregate). The COGS line at L266 already shows `(current.cogs / revenue * 100).toFixed(1)%`. Only the static warning prose at L224 still hardcodes "25%". We compute the same effective % inline and interpolate it. The Transaction-Fees mention in the same sentence already corresponds to `TRANSACTION_FEES_RATE` (6.5%) used at L274 — interpolate that constant too so the sentence can never drift from the rate actually applied.

**Step 1 — write failing DOM test** `src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import type { Aggregate } from '@/lib/analytics';

afterEach(() => cleanup());

// current.cogs / revenue = the effective rate. With cogs=3000, revenue=10000
// the prose must say 30.0% (NOT the hardcoded 25%).
const AGG: Aggregate = {
  revenue: 10000, spend: 2000, fbSpend: 1500, gaSpend: 500, ttSpend: 0,
  roas: 5, grossProfit: 8000, cogs: 3000, netProfit: 4350,
  transactionFees: 650, fixedCosts: 0, storeCount: 1, daysCovered: 1,
  trueNetProfit: 4350, trueMargin: 0.435, rowCount: 1,
};

describe('PnLBreakdown warning prose (2026-06-02)', () => {
  it('shows the ACTUAL effective COGS % (30.0%) not the hardcoded 25%', () => {
    const { getByText, container } = render(
      <PnLBreakdown current={AGG} storeNames={['uzoshop']} rangeFrom="2026-05-01" rangeTo="2026-05-31" />,
    );
    // Expand to reveal the warning + line detail.
    fireEvent.click(getByText(/הצג פירוט מלא/));
    const text = container.textContent ?? '';
    expect(text).toContain('30.0%');
    expect(text).toContain(`${(TRANSACTION_FEES_RATE * 100).toFixed(1)}%`); // 6.5%
    // The stale literal "COGS (25%)" must be gone.
    expect(text).not.toContain('COGS (25%)');
  });
});
```
(If `PnLBreakdown` requires `rows` to render the warning, the warning only shows when `!hasConfiguredFixed`, which is true here since no billing entries exist — the warning renders. `rows` is optional.)

**Step 2 — run (expect FAIL — prose says "25%"):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx
```
Expected: FAIL — `30.0%` absent, `COGS (25%)` present.

**Step 3 — minimal impl in `src/components/PnLBreakdown.tsx`.** Just above the `return (` (after L148 `const maxAmount = ...`), add a derived effective-rate string:
```ts
  // Effective rates actually applied this period (NOT hardcoded). cogs is
  // already recomputed per-store/per-month upstream (applyCogsToRows), so
  // cogs/revenue is the real blended COGS %. Fees rate is the constant the
  // fee line uses.
  const effectiveCogsPctText =
    revenue > 0 ? `${((current.cogs / revenue) * 100).toFixed(1)}%` : 'לכל חנות';
  const feesPctText = `${(TRANSACTION_FEES_RATE * 100).toFixed(1)}%`;
```
Replace the warning sentence at L223-224:
```tsx
                <strong>טרם הוגדרו עלויות חודשיות.</strong> ה-P&amp;L כרגע משקלל רק
                COGS (25%) ו-Transaction Fees (6.5%) — בלי Shopify Plan,
```
with:
```tsx
                <strong>טרם הוגדרו עלויות חודשיות.</strong> ה-P&amp;L כרגע משקלל רק
                COGS ({effectiveCogsPctText}) ו-Transaction Fees ({feesPctText}) — בלי Shopify Plan,
```

**Step 4 — run (expect PASS) + type-check:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx
npx tsc --noEmit
```
Expected: PASS.

**Step 5 — commit:**
```bash
git add src/components/PnLBreakdown.tsx src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx
git commit -m "fix(pnl): warning prose shows actual effective COGS % + fees rate

Replaces the hardcoded 'COGS (25%) / 6.5%' sentence with current.cogs/
revenue (the recomputed per-store/per-month effective rate) and
TRANSACTION_FEES_RATE, so the prose can't drift from the applied rates.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12 — Explicit per-store COGS-rate disclosure in `aiReport.ts`

**Files**
- Modify `src/lib/aiReport.ts` (add a per-store COGS-rate line using `getCogsRateForStore`)
- Test: Create `src/lib/__tests__/aiReportCogsRateDisclosure.test.ts`

**Design note:** The report's summary COGS line (L249-250) already shows the blended effective `%`, and the methodology note (L2276) already says "לפי שיעור לכל חנות" generically. The remaining gap the design names is that the report never states the *actual per-store rates*. We add one explicit disclosure line listing each store's configured COGS rate via `getCogsRateForStore`. This is additive prose — no math change.

**Step 1 — locate the methodology line + the per-store store list.** The methodology note lives around L2276 (`out.push('- **COGS משוער**: לפי שיעור לכל חנות ...')`). The report already knows the store names in scope (the per-store table iterates them). Identify the variable holding the in-scope store names in `generateAiReport` (e.g. the loop that builds the daily/per-store table). Confirm with:
```bash
grep -n "storeName\|storeNames\|stores\b\|getCogsRateForStore" src/lib/aiReport.ts | head
```

**Step 2 — write failing test** `src/lib/__tests__/aiReportCogsRateDisclosure.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';

// Phase 1 (2026-06-02) — the report must DISCLOSE the actual per-store COGS
// rate (via getCogsRateForStore), not just say "per store" generically. With
// no env override, the default is 25% → the disclosure names "25%".
describe('aiReport per-store COGS disclosure (2026-06-02)', () => {
  it('names the actual COGS rate for an in-scope store', () => {
    const report = generateAiReport(MINIMAL_DATA);
    // The default rate (no *_COGS_RATE env) is 0.25 → "25".
    expect(report).toMatch(/COGS[^|]*25%/);
  });
});

// Minimal DashboardData fixture covering exactly what generateAiReport reads
// for the summary + methodology section. Fill from the real DashboardData
// shape (src/lib/types.ts) — include one store ('uzoshop') with one daily row
// so the per-store section renders. Keep numbers tiny.
const MINIMAL_DATA = {
  /* ...populate per the real DashboardData type... */
} as unknown as Parameters<typeof generateAiReport>[0];
```
(When implementing, replace the placeholder fixture with a real minimal `DashboardData` — copy the smallest fixture pattern an existing aiReport test uses. Confirm the exact `generateAiReport` signature first: `grep -n "export function generateAiReport" src/lib/aiReport.ts`. If an existing aiReport test already builds a fixture, import/clone it instead of hand-rolling.)

**Step 3 — run (expect FAIL — no explicit per-store rate disclosure):**
```bash
npx vitest run src/lib/__tests__/aiReportCogsRateDisclosure.test.ts
```
Expected: FAIL — the report doesn't yet name the per-store rate.

**Step 4 — minimal impl in `src/lib/aiReport.ts`.** Add the import (with the other `@/lib/analytics` imports):
```ts
import { getCogsRateForStore } from '@/lib/analytics';
```
After the methodology COGS note (the `out.push('- **COGS משוער**: ...')` line ~L2276), push a per-store disclosure built from the in-scope store names (use whichever variable holds them — shown here as `storeNames`):
```ts
  // Explicit per-store COGS rate disclosure (2026-06-02): names the ACTUAL
  // rate getCogsRateForStore returns for each store rather than a generic
  // "per store" — keeps the report honest about the inputs.
  for (const s of storeNames) {
    out.push(`  - ${s}: COGS ${(getCogsRateForStore(s) * 100).toFixed(0)}%`);
  }
```
(If the methodology section iterates a different store-name source, use that.)

**Step 5 — run (expect PASS) + type-check:**
```bash
npx vitest run src/lib/__tests__/aiReportCogsRateDisclosure.test.ts
npx tsc --noEmit
```
Expected: PASS.

**Step 6 — commit:**
```bash
git add src/lib/aiReport.ts src/lib/__tests__/aiReportCogsRateDisclosure.test.ts
git commit -m "fix(ai-report): disclose actual per-store COGS rates

Adds a per-store COGS-rate line via getCogsRateForStore so the report
states the real configured rate (default 25%) instead of only the generic
'per store' methodology note. Additive prose; no math change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13 — Display-only leader-badge guard in `multiMappingCohort.ts`

**Files**
- Modify `src/lib/multiMappingCohort.ts` (add `leaderQualifies` to `MultiMappingCohort`; set it from `current.metrics.roasShopify >= 2`; `isLeader`/`isWeakest`/ranking math UNCHANGED)
- Test: Create `src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts`

**Design note:** The trophy should not show when the rank-1 member is below the 2x band floor ("best of a losing cohort"). We add a NEW display-only boolean `leaderQualifies = isLeader && current ROAS ≥ 2` WITHOUT touching `isLeader`, `currentRank`, `compareCohortMembers`, or the cohort/mapping math. `cannibalizationDetection.test` consumes the ranking math, not `leaderQualifies`, so it stays green.

**Step 1 — write failing test** `src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { qualifiesAsLeader } from '@/lib/multiMappingCohort';

// The trophy guard is display-only: leaderQualifies = isLeader && roasShopify >= 2.
// Extract it as a PURE function so it's tested with plain inputs — no cohort
// fixture needed, and the ranking/mapping math is never touched.
describe('qualifiesAsLeader — leader-badge display guard (2026-06-02)', () => {
  it('FALSE when not the leader, regardless of ROAS', () => {
    expect(qualifiesAsLeader(false, 5)).toBe(false);
  });
  it('FALSE when leader but ROAS < 2 (no trophy on a losing cohort)', () => {
    expect(qualifiesAsLeader(true, 1.4)).toBe(false);
  });
  it('TRUE when leader and ROAS >= 2', () => {
    expect(qualifiesAsLeader(true, 3.1)).toBe(true);
  });
  it('FALSE when leader but roasShopify is null/undefined', () => {
    expect(qualifiesAsLeader(true, null)).toBe(false);
  });
});
```

**Step 2 — run (expect FAIL — `leaderQualifies` missing):**
```bash
npx vitest run src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts
```
Expected: FAIL — property `leaderQualifies` does not exist (and/or fixture TODO).

**Step 3 — minimal impl in `src/lib/multiMappingCohort.ts`.** Add to the `MultiMappingCohort` type (after `isWeakest`):
```ts
  /**
   * Display-only (2026-06-02): show the 🏆 leader chip ONLY when the rank-1
   * member also clears the 2x ROAS band floor. A "best of a losing cohort"
   * (all members < 2x) is NOT a win to celebrate. Does NOT affect ranking,
   * isLeader, isWeakest, or any cohort/mapping math — purely a UI gate.
   */
  leaderQualifies: boolean;
```
Add the pure helper near the top of the module (exported for the test):
```ts
/** Display-only leader-badge guard (2026-06-02): show the 🏆 trophy ONLY when the
 *  rank-1 member also clears the locked 2x ROAS band floor — "best of a losing
 *  cohort" (all < 2x) is not a win. PURE; does NOT touch ranking/isLeader/mapping. */
export function qualifiesAsLeader(isLeader: boolean, roasShopify: number | null | undefined): boolean {
  return isLeader && roasShopify != null && roasShopify >= 2;
}
```
Where `isLeader` is computed (~L387), add (do NOT change `isLeader`):
```ts
  const leaderQualifies = qualifiesAsLeader(isLeader, currentWithFlag.metrics?.roasShopify ?? null);
```
Add `leaderQualifies` to the returned object (next to `isLeader`):
```ts
    isLeader,
    leaderQualifies,
    isWeakest,
```

**Step 4 — run (expect PASS) + type-check + the mapping suites that must stay green:**
```bash
npx vitest run src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts
npx tsc --noEmit
npx vitest run src/lib/__tests__/cannibalizationDetection.test.ts
```
Expected: all PASS (cannibalizationDetection unaffected — it reads ranking, not `leaderQualifies`).

**Step 5 — wire the UI gate (display-only consumer).** Find where the trophy/leader chip renders:
```bash
grep -rn "isLeader\|🏆\|🥇\|leader" src/components --include="*.tsx" | grep -v test
```
At the trophy render site, change the condition from `cohort.isLeader` to `cohort.leaderQualifies` (trophy only). Leave any rank-number / "rank 1 of N" text on `isLeader` if it's a neutral fact rather than a celebratory badge. If a DOM test covers that component, run it; otherwise this is a one-line conditional swap guarded by tsc.

**Step 6 — type-check + commit:**
```bash
npx tsc --noEmit
git add src/lib/multiMappingCohort.ts src/lib/__tests__/multiMappingCohortLeaderGuard.test.ts
git commit -m "fix(cohort): display-only leaderQualifies gate (no trophy for sub-2x leader)

Adds leaderQualifies = isLeader && roasShopify >= 2 to the cohort result;
the UI trophy now reads leaderQualifies. Ranking math (isLeader/isWeakest/
compareCohortMembers) untouched — cannibalizationDetection green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14 — Logout button wired to `/api/logout`

**Files**
- Create `src/app/logout/LogoutButton.tsx` (client component) — OR co-locate next to the existing chrome; confirm where global chrome (Sidebar/Header) mounts and place there. Plan assumes a standalone primitive consumed by the Sidebar.
- Test: Create `src/components/__tests__/logoutButton.dom.test.tsx`

**Step 1 — confirm the logout API contract.** Read the route to learn its method + redirect behavior:
```bash
grep -n "export async function\|NextResponse\|redirect\|cookies" src/app/api/logout/route.ts
```
Assume it accepts `POST` and clears the session cookie. The button posts and then navigates to `/`.

**Step 2 — write failing DOM test** `src/components/__tests__/logoutButton.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LogoutButton } from '@/app/logout/LogoutButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LogoutButton (2026-06-02)', () => {
  it('POSTs to /api/logout when clicked', async () => {
    const spy = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', spy);
    const { getByRole } = render(<LogoutButton />);
    fireEvent.click(getByRole('button', { name: /התנתק|logout/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' })),
    );
  });
});
```

**Step 3 — run (expect FAIL — component doesn't exist):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/logoutButton.dom.test.tsx
```
Expected: FAIL — module not found.

**Step 4 — minimal impl** `src/app/logout/LogoutButton.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Logout button (2026-06-02). POSTs to /api/logout (clears the session
 * cookie server-side) then hard-navigates to "/" so the now-unauthenticated
 * shell re-renders the gate. Single-user, URL-obscurity trust model.
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/logout', { method: 'POST' });
          window.location.assign('/');
        } catch {
          setBusy(false);
        }
      }}
      className="gap-2 text-ink-secondary hover:text-ink"
    >
      <LogOut size={16} aria-hidden />
      <span>התנתק</span>
    </Button>
  );
}
```

**Step 5 — run (expect PASS) + type-check:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/logoutButton.dom.test.tsx
npx tsc --noEmit
```
Expected: PASS.

**Step 6 — mount it in the chrome.** Add `<LogoutButton />` to the Sidebar/global chrome footer:
```bash
grep -rn "export function Sidebar\|<Sidebar" src/components --include="*.tsx" | grep -v test
```
Place `<LogoutButton />` in the Sidebar's footer region (import `{ LogoutButton } from '@/app/logout/LogoutButton'`). Run the Sidebar DOM test to confirm no regression:
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/Sidebar.dom.test.tsx
```
Expected: PASS.

**Step 7 — commit:**
```bash
git add src/app/logout/LogoutButton.tsx src/components/__tests__/logoutButton.dom.test.tsx src/components/Sidebar.tsx
git commit -m "feat(auth): wire a logout button to POST /api/logout

Ghost-variant button posts to /api/logout then hard-navigates to '/'.
Mounted in the sidebar footer. lucide LogOut icon.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: the "mobile tooltip portal in CampaignsTable" sub-item is **optional/small** per the design and is intentionally deferred to a later plan to keep Plan A's CampaignsTable touch limited to the Phase-2 directional-ROAS label change (Task 16) — avoids two competing diffs on the same render path in one plan.

---

## PHASE 2 — Framing / trust (copy-only, reversible)

### Task 15 — Relabel hero ROAS → "MER" + tooltip

**Files**
- Modify `src/components/home/CommandCenterHero.tsx` (ROAS card `HeroCardHeader label="ROAS"` → `"MER"` at ~L765; add a `title` tooltip on the ROAS `<Card>` at ~L759)
- Test: Create `src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx`

**Design note:** Value (`current.roas` = `revenue / spend` blended = MER), `band={roasBand.band}`, and the gradient are UNCHANGED. Only the eyebrow label + a `title` attribute change. The `data-testid="hero-roas"` stays.

**Step 1 — write failing DOM test** `src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CommandCenterHero, type CommandCenterPeriod } from '@/components/home/CommandCenterHero';

afterEach(() => cleanup());

const PERIOD: CommandCenterPeriod = {
  roas: 2.8, netProfit: 4847, operatingProfit: 5500, revenue: 10998,
  spend: 3924, cpm: 8.92, orders: 188, cogs: 2750,
};

describe('CommandCenterHero MER framing (2026-06-02)', () => {
  it('the ROAS hero card eyebrow reads "MER" (not "ROAS")', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    const card = getByTestId('hero-roas');
    expect(card.textContent).toContain('MER');
  });

  it('the ROAS card carries a title tooltip explaining MER', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    const card = getByTestId('hero-roas');
    expect(card.getAttribute('title') ?? '').toMatch(/MER|הכנסות.*הוצאות|blended|משוקלל/i);
  });

  it('the band is unchanged (green for 2.8x)', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    expect(getByTestId('hero-roas').getAttribute('data-band')).toBe('green');
  });
});
```

**Step 2 — run (expect FAIL — eyebrow says "ROAS", no title):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx
```
Expected: FAIL.

**Step 3 — minimal impl in `src/components/home/CommandCenterHero.tsx`.** Change the ROAS card (~L759-765):
```tsx
        <Card
          band={roasBand.band}
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-roas"
          title="MER — Marketing Efficiency Ratio: סך ההכנסות ÷ סך ההוצאות (ROAS משוקלל על כל הפלטפורמות). מקור האמת היחיד לרווחיות הפרסום."
        >
          <HeroCardHeader label="MER" />
```
(Only `label` and the new `title` change; everything below — the `<bdi>` value, `DeltaLine`, `MiniSparkline` — stays.)

**Step 4 — run (expect PASS) + type-check + the existing hero test (must stay green — it asserts 7 cards + bands, NOT the "ROAS" string):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx
```
Expected: all PASS. (If the existing hero test asserts the literal "ROAS" eyebrow string anywhere, update that assertion to "MER" in the same commit — grep it first: `grep -n '"ROAS"\|>ROAS<\|ROAS' src/components/home/__tests__/CommandCenterHero.dom.test.tsx`.)

**Step 5 — commit:**
```bash
git add src/components/home/CommandCenterHero.tsx src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx
git commit -m "feat(hero): label blended ROAS as MER + add tooltip

Eyebrow ROAS->MER on the hero ROAS card + a title tooltip naming the
Marketing Efficiency Ratio. Value (revenue/spend), band, and gradient
unchanged. data-testid retained.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 16 — Demote per-platform ROAS to "directional / מכוון" in CampaignsTable

**Files**
- Modify `src/components/CampaignsTable.tsx` (the per-platform `roas` `SortHeader` label at ~L1907-1911 → stacked label; tooltip already names "directional"-style caveat)
- Test: Create `src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx`

**Design note:** `SortHeader.label` is typed `React.ReactNode` (L2577), so a stacked two-line label is supported (the `roasShopifyPlatform` header at L1936-1942 already uses this pattern). We change only the per-platform `roas` header label; sort key, data, and the "ROAS Shopify" deterministic columns are untouched (promoted by contrast).

**Step 1 — write failing DOM test** `src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CampaignsTable } from '@/components/CampaignsTable';

afterEach(() => cleanup());

// Build the smallest props CampaignsTable needs to render its header row.
// Confirm the real prop shape first:
//   grep -n "export function CampaignsTable\|type.*Props\|interface.*Props" src/components/CampaignsTable.tsx
// Clone a fixture from an existing campaignsTable*.dom.test.tsx.
describe('CampaignsTable per-platform ROAS demotion (2026-06-02)', () => {
  it('the platform-ROAS header carries a "מכוון" (directional) sub-label', () => {
    const { container } = render(<CampaignsTable {...MINIMAL_PROPS} />);
    const head = container.querySelector('[data-col-id="roas"]');
    expect(head?.textContent ?? '').toMatch(/מכוון/);
  });

  it('the deterministic "ROAS Shopify" header is still present (promoted)', () => {
    const { container } = render(<CampaignsTable {...MINIMAL_PROPS} />);
    const det = container.querySelector('[data-col-id="roasShopify"]');
    expect(det?.textContent ?? '').toContain('ROAS Shopify');
  });
});

const MINIMAL_PROPS = { /* ...clone from an existing campaignsTable dom test... */ } as never;
```
(Replace `MINIMAL_PROPS` with a real fixture cloned from `src/components/__tests__/campaignsTableAllStoresRegression.dom.test.tsx` or similar — confirm prop shape via grep.)

**Step 2 — run (expect FAIL — header is just "ROAS"):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx
```
Expected: FAIL.

**Step 3 — minimal impl in `src/components/CampaignsTable.tsx`.** Change the `roas` `SortHeader` `label` (~L1909) from `label="ROAS"` to the stacked form (mirroring the `roasShopifyPlatform` pattern):
```tsx
                    label={
                      <span className="inline-flex flex-col items-center leading-tight">
                        <span>ROAS</span>
                        <span className="text-[9px] text-ink-muted font-normal">מכוון · directional</span>
                      </span>
                    }
```
Leave `sortKey="roas"`, `dataColId="roas"`, and the existing `tooltip` (which already says "קח עם מלח, השווה ל-ROAS Shopify") unchanged.

**Step 4 — run (expect PASS) + type-check + existing CampaignsTable DOM regressions:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/__tests__/campaignsTableAllStoresRegression.dom.test.tsx src/components/__tests__/campaignsTableEffectiveStoreV2.dom.test.tsx src/components/__tests__/campaignsAllocatedColumn.dom.test.tsx
```
Expected: all PASS.

**Step 5 — commit:**
```bash
git add src/components/CampaignsTable.tsx src/components/__tests__/campaignsTableRoasDirectional.dom.test.tsx
git commit -m "feat(campaigns): demote per-platform ROAS to directional / מכוון

Platform-reported ROAS header gains a 'מכוון · directional' sub-label
(mirrors the roasShopifyPlatform stacked pattern); the deterministic
'ROAS Shopify' columns are promoted by contrast. Sort key + data
unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 17 — Demote per-platform ROAS to "directional / מכוון" in AdsDrawer

**Files**
- Modify `src/components/AdsDrawer.tsx` (the `AdSortHeader label="ROAS"` at L511; the totals `Stat label="ROAS"` at L489)
- Test: Create `src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx`

**Design note:** `AdSortHeader` and `Stat` `label` props accept strings; for the column header we append the directional cue inline. The deterministic "ROAS Shopify" column (L514) is the promoted one. Sort key + values unchanged.

**Step 1 — write failing DOM test** `src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AdsDrawer } from '@/components/AdsDrawer';

afterEach(() => cleanup());

// Clone the open-drawer props from src/components/__tests__/adsDrawerError.dom.test.tsx
// (it already mounts AdsDrawer). Provide a summary with >=1 ad so the table renders.
describe('AdsDrawer per-platform ROAS demotion (2026-06-02)', () => {
  it('the platform-ROAS column header shows the directional cue', () => {
    const { container } = render(<AdsDrawer {...OPEN_PROPS} />);
    expect(container.textContent ?? '').toMatch(/מכוון|directional/);
  });
});

const OPEN_PROPS = { /* ...clone from adsDrawerError.dom.test.tsx with summary.ads.length>=1... */ } as never;
```
(Confirm `AdsDrawer` props + an open-with-ads fixture from `adsDrawerError.dom.test.tsx` / `adsOverModalStack.dom.test.tsx`.)

**Step 2 — run (expect FAIL):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx
```
Expected: FAIL.

**Step 3 — minimal impl in `src/components/AdsDrawer.tsx`.** Change the ROAS column header (L511) to a stacked label. Replace:
```tsx
                  <AdSortHeader label="ROAS"      col="roas"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="center" />
```
with:
```tsx
                  <AdSortHeader
                    label={
                      <span className="inline-flex flex-col items-center leading-tight">
                        <span>ROAS</span>
                        <span className="text-[9px] text-ink-muted font-normal">מכוון · directional</span>
                      </span>
                    }
                    col="roas"
                    sortKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                  />
```
Confirm `AdSortHeader`'s `label` prop type accepts `React.ReactNode` (`grep -n "function AdSortHeader\|label" src/components/AdsDrawer.tsx`); if it's typed `string`, widen it to `React.ReactNode` in the same edit. Leave the totals `Stat label="ROAS"` (L489) as-is OR, if `Stat` supports a sublabel, append " (מכוון)" — keep it to a string-only tweak to avoid widening `Stat`. Minimum: the column header carries the cue.

**Step 4 — run (expect PASS) + type-check + existing AdsDrawer DOM regressions:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/__tests__/adsDrawerError.dom.test.tsx src/components/__tests__/adsOverModalStack.dom.test.tsx
```
Expected: all PASS.

**Step 5 — commit:**
```bash
git add src/components/AdsDrawer.tsx src/components/__tests__/adsDrawerRoasDirectional.dom.test.tsx
git commit -m "feat(ads-drawer): demote per-platform ROAS to directional / מכוון

Ad-level platform ROAS column header gains the 'מכוון · directional' cue;
the deterministic ROAS Shopify column stays the trusted one. Sort key +
values unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 18 — Align P&L ad-spend note ROAS → MER

**Files**
- Modify `src/components/PnLBreakdown.tsx` (the ad-spend `PnLLine` `note` at L258 — `· ROAS X.XX` → `· MER X.XX`)
- Test: Create `src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx`

**Step 1 — write failing DOM test** `src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import type { Aggregate } from '@/lib/analytics';

afterEach(() => cleanup());

const AGG: Aggregate = {
  revenue: 10000, spend: 2000, fbSpend: 1500, gaSpend: 500, ttSpend: 0,
  roas: 5, grossProfit: 8000, cogs: 2500, netProfit: 4850,
  transactionFees: 650, fixedCosts: 0, storeCount: 1, daysCovered: 1,
  trueNetProfit: 4850, trueMargin: 0.485, rowCount: 1,
};

describe('PnLBreakdown ad-spend note MER (2026-06-02)', () => {
  it('the ad-spend line note reads "MER 5.00" (not "ROAS 5.00")', () => {
    const { getByText, container } = render(
      <PnLBreakdown current={AGG} storeNames={['uzoshop']} rangeFrom="2026-05-01" rangeTo="2026-05-31" />,
    );
    fireEvent.click(getByText(/הצג פירוט מלא/));
    const text = container.textContent ?? '';
    expect(text).toContain('MER 5.00');
    expect(text).not.toMatch(/· ROAS 5\.00/);
  });
});
```

**Step 2 — run (expect FAIL — note says "ROAS"):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx
```
Expected: FAIL.

**Step 3 — minimal impl in `src/components/PnLBreakdown.tsx`.** Change the ad-spend `PnLLine` note (L258):
```tsx
              note={`${(current.ttSpend ?? 0) > 0 ? 'Meta + Google + TikTok' : 'Meta + Google'} · ROAS ${current.roas > 0 ? current.roas.toFixed(2) : '—'}`}
```
to:
```tsx
              note={`${(current.ttSpend ?? 0) > 0 ? 'Meta + Google + TikTok' : 'Meta + Google'} · MER ${current.roas > 0 ? current.roas.toFixed(2) : '—'}`}
```

**Step 4 — run (expect PASS) + type-check:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx
npx tsc --noEmit
```
Expected: PASS.

**Step 5 — commit:**
```bash
git add src/components/PnLBreakdown.tsx src/components/__tests__/pnlBreakdownMerNote.dom.test.tsx
git commit -m "feat(pnl): align ad-spend note ROAS->MER

The blended figure on the P&L ad-spend line is MER (revenue/spend across
platforms); relabel the note accordingly. Value unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 19 — Coverage computation in `lib/home/adapters.ts`

**Files**
- Modify `src/lib/home/adapters.ts` (add `computeCoverage()` + `toCoverageChip()`)
- Test: Create `src/lib/home/__tests__/coverage.test.ts`

**Design note:** Coverage % = orders with ANY click-id/UTM signal ÷ total orders. "Has any signal" = `fbclidPresent || gclidPresent || source` is a non-empty paid/organic/email/referral label OR any non-empty `utm_source/utm_medium/utm_campaign/utm_content/utm_id/utm_term`. Unknown = the remainder. **Channels + unknown = 100%, never redistributed.** The chip is `prominent` only when `unknownShare > 0.30`.

**Step 1 — write failing test** `src/lib/home/__tests__/coverage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeCoverage, toCoverageChip } from '@/lib/home/adapters';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

function row(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-20', storeId: 'uzoshop', orderId: 'x', totalCad: 10,
    source: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
    fbclidPresent: false, gclidPresent: false, referrer: '', utmId: '', utmTerm: '',
    ...overrides,
  } as OrderAttributionRow;
}

describe('computeCoverage (2026-06-02)', () => {
  it('returns 0/0 with no orders (caller renders nothing)', () => {
    expect(computeCoverage([])).toEqual({ total: 0, covered: 0, coverageShare: 0, unknownShare: 0 });
  });

  it('counts fbclid / gclid / utm / source as covered; bare rows as unknown', () => {
    const rows = [
      row({ fbclidPresent: true }),
      row({ gclidPresent: true }),
      row({ utmSource: 'klaviyo' }),
      row({ source: 'meta-paid' }),
      row({}), // unknown
    ];
    const r = computeCoverage(rows);
    expect(r.total).toBe(5);
    expect(r.covered).toBe(4);
    expect(r.coverageShare).toBeCloseTo(0.8, 5);
    expect(r.unknownShare).toBeCloseTo(0.2, 5);
  });

  it('coverageShare + unknownShare always sum to 1 (never redistributed)', () => {
    const rows = [row({ utmCampaign: 'spring' }), row({}), row({}), row({})];
    const r = computeCoverage(rows);
    expect(r.coverageShare + r.unknownShare).toBeCloseTo(1, 9);
  });
});

describe('toCoverageChip (2026-06-02)', () => {
  it('is QUIET when unknown <= 30%', () => {
    const chip = toCoverageChip({ total: 10, covered: 8, coverageShare: 0.8, unknownShare: 0.2 });
    expect(chip).not.toBeNull();
    expect(chip!.prominent).toBe(false);
  });

  it('is PROMINENT when unknown > 30%', () => {
    const chip = toCoverageChip({ total: 10, covered: 6, coverageShare: 0.6, unknownShare: 0.4 });
    expect(chip!.prominent).toBe(true);
  });

  it('is null when there are no orders', () => {
    expect(toCoverageChip({ total: 0, covered: 0, coverageShare: 0, unknownShare: 0 })).toBeNull();
  });
});
```

**Step 2 — run (expect FAIL — functions don't exist):**
```bash
npx vitest run src/lib/home/__tests__/coverage.test.ts
```
Expected: FAIL.

**Step 3 — minimal impl. Append to `src/lib/home/adapters.ts`:**
```ts
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

/* --------------------------------------------------------------------------
 * Attribution coverage (hero-only, honest)
 * -------------------------------------------------------------------------- */

export interface CoverageResult {
  total: number;
  covered: number;
  /** covered / total (0 when total === 0). */
  coverageShare: number;
  /** 1 − coverageShare (the unknown remainder). */
  unknownShare: number;
}

/** An order is "covered" when it carries ANY attribution signal. */
function hasAttributionSignal(o: OrderAttributionRow): boolean {
  return (
    o.fbclidPresent ||
    o.gclidPresent ||
    o.source.trim() !== '' ||
    o.utmSource.trim() !== '' ||
    o.utmMedium.trim() !== '' ||
    o.utmCampaign.trim() !== '' ||
    o.utmContent.trim() !== '' ||
    o.utmId.trim() !== '' ||
    o.utmTerm.trim() !== ''
  );
}

/**
 * Honest coverage from existing orders_attribution fields. Coverage =
 * orders with any click-id/UTM ÷ total; unknown = remainder. The two shares
 * sum to 1 and are NEVER redistributed across channels.
 */
export function computeCoverage(rows: readonly OrderAttributionRow[]): CoverageResult {
  const total = rows.length;
  if (total === 0) return { total: 0, covered: 0, coverageShare: 0, unknownShare: 0 };
  let covered = 0;
  for (const o of rows) if (hasAttributionSignal(o)) covered += 1;
  const coverageShare = covered / total;
  return { total, covered, coverageShare, unknownShare: 1 - coverageShare };
}

export interface CoverageChip {
  coverageShare: number;
  unknownShare: number;
  /** Visually prominent ONLY when the unknown share exceeds 30%. */
  prominent: boolean;
}

/** null when there are no orders (caller renders nothing). */
export function toCoverageChip(r: CoverageResult): CoverageChip | null {
  if (r.total === 0) return null;
  return {
    coverageShare: r.coverageShare,
    unknownShare: r.unknownShare,
    prominent: r.unknownShare > 0.3,
  };
}
```

**Step 4 — run (expect PASS) + type-check + existing adapters test (regression):**
```bash
npx vitest run src/lib/home/__tests__/coverage.test.ts src/lib/home/__tests__/adapters.test.ts
npx tsc --noEmit
```
Expected: all PASS.

**Step 5 — commit:**
```bash
git add src/lib/home/adapters.ts src/lib/home/__tests__/coverage.test.ts
git commit -m "feat(home): computeCoverage + toCoverageChip from orders_attribution

Coverage = orders with any click-id/UTM signal ÷ total; unknown is the
remainder. Shares sum to 1, never redistributed. Chip is prominent only
when unknown > 30%, null when there are no orders.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 20 — Quiet hero-only coverage chip + mount it

**Files**
- Create `src/components/home/CoverageChip.tsx`
- Test: Create `src/components/home/__tests__/coverageChip.dom.test.tsx`
- Modify `src/components/home/CommandCenterHero.tsx` (mount the chip on the hero; accept a `coverage?: CoverageChip` prop — NOT per-store)

**Design note:** Renders the coverage % via `<Metric>` + tokens (2026-06-01 readability standard). Quiet styling (muted ink, no border) when `!prominent`; warning-token styling when `prominent`. A `title` tooltip names the legit causes (express checkout, headless drafts, untagged, privacy-stripped). Renders `null` when `coverage` is null/undefined. **Hero only** — do NOT add to `PerStoreRow`.

**Step 1 — confirm the `<Metric>` primitive import + props:**
```bash
grep -rn "export function Metric\|export const Metric" src/components --include="*.tsx"
```
Use the real primitive path/props it returns.

**Step 2 — write failing DOM test** `src/components/home/__tests__/coverageChip.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CoverageChip } from '@/components/home/CoverageChip';

afterEach(() => cleanup());

describe('CoverageChip (2026-06-02)', () => {
  it('renders nothing when coverage is null', () => {
    const { container } = render(<CoverageChip coverage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the coverage % quietly when not prominent', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.82, unknownShare: 0.18, prominent: false }} />,
    );
    const el = getByTestId('coverage-chip');
    expect(el.textContent ?? '').toMatch(/82/);
    expect(el.getAttribute('data-prominent')).toBe('false');
  });

  it('flags prominent when unknown is high', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.55, unknownShare: 0.45, prominent: true }} />,
    );
    expect(getByTestId('coverage-chip').getAttribute('data-prominent')).toBe('true');
  });

  it('carries a tooltip naming legit unknown causes', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.55, unknownShare: 0.45, prominent: true }} />,
    );
    expect(getByTestId('coverage-chip').getAttribute('title') ?? '').toMatch(/express|headless|untagged|privacy|תשלום מהיר|לא מתויג/i);
  });
});
```

**Step 3 — run (expect FAIL — component missing):**
```bash
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/coverageChip.dom.test.tsx
```
Expected: FAIL.

**Step 4 — minimal impl** `src/components/home/CoverageChip.tsx`:
```tsx
'use client';

import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoverageChip as CoverageChipData } from '@/lib/home/adapters';

const TOOLTIP =
  'אחוז ההזמנות שנושאות סימן ייחוס (click-id / UTM). ה"לא ידוע" הנותר הוא לרוב ' +
  'תשלום מהיר (express checkout), חנות headless / draft, תנועה לא מתויגת, או ' +
  'פרמטרים שנחתכו ע״י פרטיות הדפדפן. ערוצים + לא-ידוע = 100% — לעולם לא מחולק מחדש.';

/**
 * Honest attribution-coverage chip — HERO ONLY (never on per-store cards).
 * Quiet by default (muted ink, no border); visually prominent only when the
 * unknown share is bad (> 30%). Renders nothing when there are no orders.
 * Numbers go through token-driven styling per the 2026-06-01 readability
 * standard (no raw hex; on-band/scrim tokens).
 */
export function CoverageChip({ coverage }: { coverage: CoverageChipData | null }) {
  if (!coverage) return null;
  const pct = Math.round(coverage.coverageShare * 100);
  const prominent = coverage.prominent;
  return (
    <span
      data-testid="coverage-chip"
      data-prominent={prominent ? 'true' : 'false'}
      title={TOOLTIP}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
        prominent
          ? 'bg-status-warningBg text-status-warningFg border border-status-warning'
          : 'text-ink-muted',
      )}
    >
      {prominent ? <ShieldAlert size={11} aria-hidden /> : <ShieldCheck size={11} aria-hidden />}
      <bdi dir="ltr">{pct}%</bdi>
      <span>כיסוי ייחוס</span>
    </span>
  );
}
```

**Step 5 — run (expect PASS) + type-check:**
```bash
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/coverageChip.dom.test.tsx
npx tsc --noEmit
```
Expected: PASS.

**Step 6 — mount on the hero (NOT per-store).** In `src/components/home/CommandCenterHero.tsx`:
- Add to imports:
  ```ts
  import { CoverageChip } from '@/components/home/CoverageChip';
  import type { CoverageChip as CoverageChipData } from '@/lib/home/adapters';
  ```
- Add an optional prop to the hero's props type (next to `rangeLabel`):
  ```ts
  /** Honest attribution-coverage chip — hero-only. Pass null to hide. */
  coverage?: CoverageChipData | null;
  ```
- Render `<CoverageChip coverage={coverage ?? null} />` in the hero header region (near the eyebrow row / range label, NOT inside any per-store map). Keep it visually subordinate.

**Step 7 — wire the data in `src/components/Dashboard.tsx`.** Where `<CommandCenterHero>` is rendered, compute the chip from the already-fetched current-range orders-attribution rows and pass it:
```ts
import { computeCoverage, toCoverageChip } from '@/lib/home/adapters';
// ...
const coverageChip = toCoverageChip(computeCoverage(ordersAttributionRowsForRange ?? []));
// <CommandCenterHero ... coverage={coverageChip} />
```
(Use the existing current-range orders-attribution SWR result already present in Dashboard — the `/api/orders-attribution` fetch keyed by the current range. Confirm the variable name via `grep -n "orders-attribution" src/components/Dashboard.tsx`.)

**Step 8 — type-check + run the hero tests (regression — the chip is additive and optional, so the existing 7-card test stays green):**
```bash
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx src/components/home/__tests__/commandCenterHeroMer.dom.test.tsx
```
Expected: all PASS.

**Step 9 — commit:**
```bash
git add src/components/home/CoverageChip.tsx src/components/home/__tests__/coverageChip.dom.test.tsx src/components/home/CommandCenterHero.tsx src/components/Dashboard.tsx
git commit -m "feat(home): quiet hero-only attribution-coverage chip

CoverageChip renders coverage % (token-driven, <bdi> number) — quiet by
default, prominent only when unknown > 30%. Tooltip names legit unknown
causes. Mounted on the hero only (never per-store); fed from the existing
current-range orders-attribution rows. Channels + unknown = 100%.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final full-suite verification (after all tasks)

Run both suites + the type-check to confirm the whole plan is green and the locked mapping suites never regressed:
```bash
npx tsc --noEmit
npx vitest run
npx vitest run --config vitest.config.dom.ts
# Explicit mapping-preservation proof (must all PASS):
npx vitest run \
  src/lib/__tests__/cannibalizationDetection.test.ts \
  src/lib/__tests__/campaignProductMap.test.ts \
  src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
npx vitest run $(grep -rl "campaignStoreMap\|productCentricViewSumConservation\|campaignsAggregator" src --include="*.test.ts" --include="*.test.tsx" 2>/dev/null)
```
Expected: every command exits 0.

---

## Manual verification checklist (operator, post-deploy — uses PRODUCTION URLs, never localhost)

1. **Phase 0 (invisible):** dashboard loads; AI report, sync indicator, command palette, and insights board all render data — confirms the `fetchJsonOrNull` swap didn't change behavior.
2. **TikTok override (Phase 1a):** on `/operator`, the manual-overrides form's platform dropdown now lists **tiktok**; add a TikTok override for `uzoshop` on a recent date with a known amount + currency USD; after the next cron-daily run, that date's `uzoshop` TikTok spend on the dashboard equals the override (USD→CAD), and **`usmile360` / `zolplus` TikTok numbers are unchanged** (mapping-aware, per-store only).
3. **COGS prose (Phase 1b):** open the P&L "הצג פירוט מלא" with no monthly costs configured — the warning sentence shows the **actual** effective COGS % (e.g. 25.0% by default, or whatever the editable-COGS setting yields) and the real fees % (6.5%), not a hardcoded "25%".
4. **AI report (Phase 1b):** generate the AI report; the methodology section lists each store's actual COGS rate.
5. **Leader badge (Phase 1c):** open a campaign drawer whose cohort leader is below 2x ROAS — the trophy/leader chip does **not** appear; for a cohort whose leader is ≥ 2x it does. Cohort rankings and cannibalization callouts are unchanged.
6. **Logout (Phase 1d):** the sidebar shows a "התנתק" button; clicking it logs out and returns to the gate.
7. **MER framing (Phase 2a):** the hero's former "ROAS" card now reads **"MER"** with a tooltip; the number, colour band, and gradient are identical to before.
8. **Directional ROAS (Phase 2b):** the Campaigns table's platform-reported ROAS column header and the AdsDrawer ROAS column show a "מכוון · directional" sub-label; the "ROAS Shopify" columns read as the trusted ones.
9. **P&L MER note (Phase 2c):** the P&L ad-spend line note reads "… · MER X.XX".
10. **Coverage chip (Phase 2d):** the hero shows a quiet "X% כיסוי ייחוס" chip; on a range where >30% of orders lack any click-id/UTM it turns prominent (warning tokens); the per-store cards have **no** such chip; the tooltip names express-checkout / headless / untagged / privacy causes; channel shares + unknown visibly sum to 100%.
11. **CAPI safety:** open each store's Meta / Google / TikTok Events Manager — confirm **no new events** appeared from this deploy (this plan sends nothing outbound; grep the diff for `fbq|gtag|ttq|_fbq|snaptr` → zero matches).