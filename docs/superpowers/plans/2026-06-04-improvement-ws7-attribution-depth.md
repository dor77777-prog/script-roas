# Attribution Depth (within the CAPI-safe ceiling) Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Deepen first-party attribution as far as the read-only / CAPI-safe ceiling allows, WITHOUT ever sending a pixel/CAPI event. Three honest deepenings: (1) decompose the opaque unknown/direct order bucket by signals already on every row (new-vs-returning, AOV, store, products, payment gateway); (2) capture + roll up the post-purchase "how did you hear about us" survey answer that rides on `note_attributes` (the operator's only blessed first-party demand signal); (3) a spend-pause / organic-baseline incrementality PROXY from `data_daily` that ABSTAINS when there aren't enough clean low-spend baseline days, never a hard number.

Architecture: Pure compute layer first (testable, no I/O), then a single additive nullable DB column + writer dual-write + reader passthrough for the survey signal, then mapping-aware aggregate readers + thin API routes + token-driven RTL/AA UI. We mirror the EXACT existing patterns: the `payment_gateway` column add (migration `20260603110000` + `toOrdersAttributionRow` + `ORDERS_ATTRIBUTION_SELECT` + the row map) is the template for the survey column; `readPaymentMethodsByMonth` + `lib/payments.ts` + `/api/payment-methods` + `PaymentMethodsTab` + the Sidebar `payments` entry are the template for the survey rollup; `computeCoverage`/`toCoverageChip` (`lib/home/adapters.ts`) is the home that the unknown-bucket decomposition extends; `DailyRow` (`lib/types.ts`) is the input to the incrementality proxy.

Tech Stack: Next.js (App Router) + TypeScript, Supabase Postgres (PostgREST via supabase-js, `paginate()` helper), Inngest crons (`cronDaily`, `cronLive`), SWR on the client, Tailwind with token-only theme (light+dark), vitest (node default config + dom via `vitest.config.dom.ts`), Playwright visual/axe gates, eslint with local rules (`no-physical-direction-in-components`, `no-native-title-tooltip`, `no-hex-color-in-components`, `no-emoji-in-jsx`, …). All money in CAD via the upstream FX layer; numbers render through the shared `<Money>` primitive.

---

## File Structure

### Feature A — Unknown-bucket decomposition (pure compute + hero/home surface)
- `dashboard-web/src/lib/home/unknownBucket.ts` — NEW. Pure decomposition of the unknown/direct bucket by the signals already on `OrderAttributionRow` (new-vs-returning, AOV band, per-store, top products, payment category). No I/O. One responsibility: turn `OrderAttributionRow[]` → `UnknownBucketBreakdown`.
- `dashboard-web/src/lib/home/__tests__/unknownBucket.test.ts` — NEW. Node-config unit tests for the decomposition.
- `dashboard-web/src/components/home/UnknownBucketPanel.tsx` — NEW. Token-driven, light+dark, RTL panel that renders the breakdown (opened from the existing CoverageChip). Numbers via `<Money>`.
- `dashboard-web/src/components/home/__tests__/unknownBucketPanel.dom.test.tsx` — NEW. DOM-config render tests (a11y/RTL/no-info-loss).
- `dashboard-web/src/components/home/CoverageChip.tsx` — MODIFIED. Add an optional click/expand affordance that opens `UnknownBucketPanel` (chip stays the unchanged honest summary).
- `dashboard-web/src/components/Dashboard.tsx` — MODIFIED. Compute the breakdown (memo) and pass it down alongside the existing `coverageChip`.

### Feature B — Post-purchase survey ("how did you hear about us") rollup from note_attributes
- `supabase/migrations/20260604130000_orders_attribution_survey_source.sql` — NEW. `ADD COLUMN IF NOT EXISTS survey_source TEXT` (additive, nullable).
- `dashboard-web/src/lib/survey.ts` — NEW. `SURVEY_NOTE_KEYS` (the `note_attributes` names the survey app writes), `extractSurveyAnswer(noteAttrs)` (raw free-text), and `normalizeSurveyAnswer(raw)` (canonical bucket). Mirrors `lib/payments.ts`.
- `dashboard-web/src/lib/__tests__/survey.test.ts` — NEW. Node-config unit tests for extraction + normalization.
- `dashboard-web/src/lib/fetchers/shopify.ts` — MODIFIED. Capture `surveySource` in `classifyOrderAttribution` (reads ONLY from the already-folded `params`/`noteAttrs`, no extra fetch) + add it to the order object + the `OrderAttributionRecord` type.
- `dashboard-web/src/inngest/functions/cronDaily.ts` — MODIFIED. Thread `surveySource` through `toOrdersAttributionRow` (type, body, `ordersAttributionRowKeys` exemplar) so BOTH `cronDaily` and `cronLive` dual-write it.
- `dashboard-web/src/lib/ordersAttribution.ts` — MODIFIED. Add `surveySource: string | null` to `OrderAttributionRow`.
- `dashboard-web/src/lib/postgresReaders.ts` — MODIFIED. Add `survey_source` to `ORDERS_ATTRIBUTION_SELECT` + the row map; NEW `readSurveyRollup()` aggregate reader + `SURVEY_ROLLUP_SELECT` + types (mirrors `readPaymentMethodsByMonth`).
- `dashboard-web/src/lib/__tests__/postgresReadersSurvey.test.ts` — NEW. Node-config tests for `readSurveyRollup` aggregation.
- `dashboard-web/src/app/api/survey/route.ts` — NEW. Thin GET returning the rollup (mirrors `/api/payment-methods`).
- `dashboard-web/src/components/SurveyTab.tsx` — NEW. Token-driven, light+dark, RTL tab: business-wide + per-store survey-answer split, response-rate, low-data state. Numbers via `<Money>`.
- `dashboard-web/src/components/__tests__/SurveyTab.dom.test.tsx` — NEW. DOM-config render tests.
- `dashboard-web/src/lib/urlState.ts` — MODIFIED. Add `'survey'` to `TabKey` + `TAB_VALUES`.
- `dashboard-web/src/components/Sidebar.tsx` — MODIFIED. Add the survey tab entry.
- `dashboard-web/src/components/Dashboard.tsx` — MODIFIED. Render `<SurveyTab>` for `activeTab === 'survey'`.
- `scripts/backfillSurveySource.ts` — NEW (backfill runner, run ONCE after deploy; documented, not auto-run).

### Feature C — Spend-pause / organic-baseline incrementality proxy
- `dashboard-web/src/lib/analytics/incrementality.ts` — NEW. Pure proxy: from `DailyRow[]` (mapping-aware `data_daily`), split days into low-spend ("baseline") vs high-spend buckets per store, estimate organic baseline revenue + incremental share, and ABSTAIN with an explicit reason when `cleanBaselineDays < MIN_CLEAN_BASELINE_DAYS`. NEVER returns a fabricated number.
- `dashboard-web/src/lib/analytics/__tests__/incrementality.test.ts` — NEW. Node-config unit tests incl. the abstain paths.
- `dashboard-web/src/components/IncrementalityProxyPanel.tsx` — NEW. Token-driven, light+dark, RTL panel rendered on the מגמות (trends) tab; shows the estimate OR the abstain state. Numbers via `<Money>`.
- `dashboard-web/src/components/__tests__/IncrementalityProxyPanel.dom.test.tsx` — NEW. DOM-config render tests incl. the abstain render.
- `dashboard-web/src/components/TrendsTab.tsx` (or the trends container — confirm exact name in Task C.4) — MODIFIED. Mount `<IncrementalityProxyPanel>`.

### Docs (pre-push docs-currency gate)
- `docs/ROAS-Dashboard-User-Manual.md` — MODIFIED (every UI/component change → User Manual section + version bump).
- `docs/ARCHITECTURE.md` — MODIFIED (the migration + new reader/cron-dual-write + incrementality compute → Architecture section).

---

## Cross-cutting constraints (apply to EVERY task)
- **CAPI-safe / read-only.** No task sends any event to a pixel/CAPI. The survey signal is read from `note_attributes` that an operator-installed survey app already writes (the only blessed first-party demand signal). Every new file/migration carries a one-line "CAPI-safe: zero pixel/CAPI events" comment, mirroring the existing `payment_gateway` migration prose.
- **Mapping-aware only.** Feature C reads `DailyRow[]` (from `data_daily` via the mapping-aware reader path); it NEVER touches raw account totals. Feature A/B aggregate `orders_attribution` rows (already mapping-resolved at write time).
- **Token-driven UI.** No raw hex/oklch/px colors in components (enforced by `no-hex-color-in-components`). Use existing tokens (`text-ink-*`, `bg-status-*`, `bg-surface-*`, `accent`, chart-brand tokens). Light AND dark from the start.
- **RTL / logical classes.** Use logical Tailwind classes only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`/`text-end`) — `no-physical-direction-in-components` will error on `ml-`/`pr-`/`left-`/etc. Wrap LTR numerics in `<bdi dir="ltr">` like `CoverageChip`.
- **Numbers through `<Money>`** (tabular-nums, nowrap, compact-floor, exact in `title`/`sr-only`). Never `truncate` a number.
- **Tooltips via `HelpTooltip`** (`@/components/ui/Tooltip`). Native `title=` is BANNED (`no-native-title-tooltip`).
- **Tests.** Pure-compute tests run under the node config (`npm run test`); component tests run under the dom config (`npm run test:components`). Write the FAILING test first, run it, confirm RED, then minimal impl, then GREEN.
- **Gates before any push** (run all, all must pass):
  - `npm run -s -C dashboard-web build` is NOT a gate; the gates are:
  - `npx --prefix dashboard-web tsc --noEmit -p dashboard-web/tsconfig.json` (typecheck)
  - `npm --prefix dashboard-web run test`
  - `npm --prefix dashboard-web run test:components`
  - `npm --prefix dashboard-web run lint`
  - docs-currency pre-push gate: UI/component change → update `docs/ROAS-Dashboard-User-Manual.md`; lib/inngest/migration change → update `docs/ARCHITECTURE.md`.
- **Commits.** One focused commit per task. Every commit message ends with the Co-Authored-By trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Branch.** Commit directly to `main` (operator preference; no feature branches). Do NOT push until the operator asks. Deploy is `git push origin main` ONLY (never `vercel deploy`).

---

## Feature A: Decompose the unknown/direct bucket (gap `unknown-bucket-decomposition`)

> impact: medium · effort: M · CAPI-safe: YES (pure compute over already-stored fields; zero pixel/CAPI) · dependencies: none (no other workstream; reuses `OrderAttributionRow` + `computeCoverage`).

Why: `computeCoverage` (`lib/home/adapters.ts:506-539`) honestly produces `unknownShare`, and `toCoverageChip` flags `> 30%`, but the unknown bucket is a single opaque scalar. Every field needed to characterize WHO those orders are is already on the row: `isFirstOrder` (new vs returning), `totalCad` (AOV), `storeName`, `lineItems` (products), `paymentGateway` (gateway). This feature slices the unknown bucket — without ever redistributing it across channels.

### Task A.1 — Pure `unknownBucket.ts` decomposition (failing test first)

The decomposition operates ONLY on the rows that fail `hasAttributionSignal` (the unknown bucket). It must reuse the SAME predicate so the panel can never disagree with the chip. We export the predicate from `adapters.ts` first.

- [ ] Export the unknown predicate so the decomposition reuses it (no second definition). In `dashboard-web/src/lib/home/adapters.ts`, change `function hasAttributionSignal` to `export function hasAttributionSignal`. (Single-word edit; keeps the existing body verbatim — the comment block at 508-512 stays.)
- [ ] Write the failing test file `dashboard-web/src/lib/home/__tests__/unknownBucket.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { decomposeUnknownBucket } from '../unknownBucket';
  import type { OrderAttributionRow } from '@/lib/ordersAttribution';

  // Minimal row factory — only the fields the decomposition reads matter; the
  // rest are filled with attribution-EMPTY values so the row lands in the
  // unknown bucket unless we explicitly add a signal.
  function row(over: Partial<OrderAttributionRow>): OrderAttributionRow {
    return {
      date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', orderId: 'o1',
      totalCad: 0, source: 'direct', utmSource: '', utmMedium: '', utmCampaign: '',
      utmContent: '', fbclidPresent: false, gclidPresent: false, referringSite: '',
      utmId: '', utmTerm: '', lineItems: [], customerId: null, orderCreatedAt: null,
      isFirstOrder: null, firstTouchSource: null, firstFbclidPresent: false,
      firstGclidPresent: false, firstTtclidPresent: false, firstUtmSource: null,
      firstUtmMedium: null, firstUtmCampaign: null, firstUtmContent: null,
      firstUtmId: null, firstUtmTerm: null, firstSeenAt: null,
      surveySource: null, // added in Feature B; harmless here
      ...over,
    } as OrderAttributionRow;
  }

  describe('decomposeUnknownBucket', () => {
    it('returns the empty shape when there are no rows', () => {
      const b = decomposeUnknownBucket([]);
      expect(b.unknownOrders).toBe(0);
      expect(b.newVsReturning).toEqual({ new: 0, returning: 0, unclassifiable: 0 });
      expect(b.byStore).toEqual([]);
      expect(b.topProducts).toEqual([]);
      expect(b.byPaymentCategory).toEqual({ credit: 0, paypal: 0, other: 0 });
      expect(b.aovBands).toEqual({ low: 0, mid: 0, high: 0 });
    });

    it('only counts orders WITHOUT an attribution signal (never redistributes covered)', () => {
      const rows = [
        row({ orderId: 'attributed', fbclidPresent: true, totalCad: 100 }), // covered → excluded
        row({ orderId: 'unknown', source: 'direct', totalCad: 40 }),         // unknown → counted
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.unknownOrders).toBe(1);
      expect(b.unknownRevenueCad).toBeCloseTo(40);
    });

    it('splits new vs returning vs unclassifiable by isFirstOrder', () => {
      const rows = [
        row({ orderId: 'a', isFirstOrder: true }),
        row({ orderId: 'b', isFirstOrder: false }),
        row({ orderId: 'c', isFirstOrder: null }),
        row({ orderId: 'd', isFirstOrder: true }),
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.newVsReturning).toEqual({ new: 2, returning: 1, unclassifiable: 1 });
    });

    it('buckets AOV into low (<50) / mid (50–120) / high (>120)', () => {
      const rows = [
        row({ orderId: 'a', totalCad: 30 }),
        row({ orderId: 'b', totalCad: 80 }),
        row({ orderId: 'c', totalCad: 200 }),
        row({ orderId: 'd', totalCad: 120 }), // inclusive upper edge of mid
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.aovBands).toEqual({ low: 1, mid: 2, high: 1 });
    });

    it('groups by store (display name) descending by orders', () => {
      const rows = [
        row({ orderId: 'a', storeName: 'Zol Plus' }),
        row({ orderId: 'b', storeName: '360usmile' }),
        row({ orderId: 'c', storeName: 'Zol Plus' }),
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.byStore[0]).toEqual({ store: 'Zol Plus', orders: 2 });
      expect(b.byStore[1]).toEqual({ store: '360usmile', orders: 1 });
    });

    it('rolls top products from lineItems (capped at TOP_N), descending by units', () => {
      const rows = [
        row({ orderId: 'a', lineItems: [{ productId: 'p1', units: 2, revenueCad: 20 }] }),
        row({ orderId: 'b', lineItems: [{ productId: 'p1', units: 1, revenueCad: 10 },
                                        { productId: 'p2', units: 5, revenueCad: 50 }] }),
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.topProducts[0]).toEqual({ productId: 'p2', units: 5, revenueCad: 50 });
      expect(b.topProducts[1]).toEqual({ productId: 'p1', units: 3, revenueCad: 30 });
    });

    it('categorizes payment gateway via the shared categorizer', () => {
      const rows = [
        row({ orderId: 'a', paymentGateway: 'paypal' }),
        row({ orderId: 'b', paymentGateway: 'shopify_payments' }),
        row({ orderId: 'c', paymentGateway: null }), // → other
      ];
      const b = decomposeUnknownBucket(rows);
      expect(b.byPaymentCategory).toEqual({ credit: 1, paypal: 1, other: 1 });
    });
  });
  ```
  Note: this test references `paymentGateway` on `OrderAttributionRow`. `paymentGateway` is on the WRITER record + DB column already (Feature B migration `20260603110000`) but is NOT yet on the read-side `OrderAttributionRow` type. Add it as part of THIS task (it is already stored — wiring it onto the read row is a missing-passthrough fix the decomposition needs):
  - In `dashboard-web/src/lib/ordersAttribution.ts`, after `firstSeenAt: string | null;` add:
    ```ts
    /** תשלומים — raw primary Shopify payment gateway name (credit/paypal/other
     *  via categorizePaymentGateway). NULL = not backfilled / order lists none. */
    paymentGateway: string | null;
    ```
  - In `dashboard-web/src/lib/postgresReaders.ts`: append `, payment_gateway` to `ORDERS_ATTRIBUTION_SELECT` (line 69-77 block) and, in the row map (after `firstSeenAt:` at ~line 1131), add:
    ```ts
    paymentGateway:
      r.payment_gateway == null ? null : String(r.payment_gateway).trim() || null,
    ```
- [ ] Run it and confirm it FAILS (module not found / shape mismatch):
  `npm --prefix dashboard-web run test -- src/lib/home/__tests__/unknownBucket.test.ts`
  Expected: FAIL (red) — `unknownBucket` does not exist yet.
- [ ] Minimal impl `dashboard-web/src/lib/home/unknownBucket.ts`:
  ```ts
  /**
   * Decompose the UNKNOWN/direct order bucket by signals ALREADY on each row.
   *
   * The unknown bucket is the set of orders that carry NO attribution signal —
   * the exact complement of `hasAttributionSignal` (the same predicate the hero
   * CoverageChip uses, so the panel can never disagree with the chip). This is a
   * DESCRIPTIVE slice (who ARE these orders?) — it NEVER redistributes the
   * unknown share across channels (covered + unknown still = 100%).
   *
   * CAPI-safe: pure compute over orders_attribution fields already in hand; zero
   * pixel/CAPI events. Mapping-aware by construction (rows are written
   * mapping-resolved).
   */
  import type { OrderAttributionRow } from '@/lib/ordersAttribution';
  import { hasAttributionSignal } from '@/lib/home/adapters';
  import { categorizePaymentGateway, type PaymentCategory } from '@/lib/payments';

  /** AOV band edges (CAD). low < 50 ≤ mid ≤ 120 < high. */
  export const AOV_LOW_MAX = 50;
  export const AOV_HIGH_MIN = 120;
  /** Max products surfaced in the breakdown. */
  export const TOP_PRODUCTS_N = 5;

  export interface UnknownBucketBreakdown {
    unknownOrders: number;
    unknownRevenueCad: number;
    newVsReturning: { new: number; returning: number; unclassifiable: number };
    aovBands: { low: number; mid: number; high: number };
    byStore: Array<{ store: string; orders: number }>;
    topProducts: Array<{ productId: string; units: number; revenueCad: number }>;
    byPaymentCategory: Record<PaymentCategory, number>;
  }

  function emptyBreakdown(): UnknownBucketBreakdown {
    return {
      unknownOrders: 0,
      unknownRevenueCad: 0,
      newVsReturning: { new: 0, returning: 0, unclassifiable: 0 },
      aovBands: { low: 0, mid: 0, high: 0 },
      byStore: [],
      topProducts: [],
      byPaymentCategory: { credit: 0, paypal: 0, other: 0 },
    };
  }

  export function decomposeUnknownBucket(
    rows: readonly OrderAttributionRow[],
  ): UnknownBucketBreakdown {
    const out = emptyBreakdown();
    const storeCounts = new Map<string, number>();
    const productAgg = new Map<string, { units: number; revenueCad: number }>();

    for (const o of rows) {
      if (hasAttributionSignal(o)) continue; // covered — never counted here
      out.unknownOrders += 1;
      const aov = Number.isFinite(o.totalCad) ? o.totalCad : 0;
      out.unknownRevenueCad += aov;

      if (o.isFirstOrder === true) out.newVsReturning.new += 1;
      else if (o.isFirstOrder === false) out.newVsReturning.returning += 1;
      else out.newVsReturning.unclassifiable += 1;

      if (aov < AOV_LOW_MAX) out.aovBands.low += 1;
      else if (aov > AOV_HIGH_MIN) out.aovBands.high += 1;
      else out.aovBands.mid += 1;

      storeCounts.set(o.storeName, (storeCounts.get(o.storeName) ?? 0) + 1);

      out.byPaymentCategory[categorizePaymentGateway(o.paymentGateway)] += 1;

      for (const li of o.lineItems) {
        const cur = productAgg.get(li.productId) ?? { units: 0, revenueCad: 0 };
        cur.units += Number.isFinite(li.units) ? li.units : 0;
        cur.revenueCad += Number.isFinite(li.revenueCad) ? li.revenueCad : 0;
        productAgg.set(li.productId, cur);
      }
    }

    out.byStore = [...storeCounts.entries()]
      .map(([store, orders]) => ({ store, orders }))
      .sort((a, b) => b.orders - a.orders);

    out.topProducts = [...productAgg.entries()]
      .map(([productId, v]) => ({ productId, units: v.units, revenueCad: v.revenueCad }))
      .sort((a, b) => b.units - a.units)
      .slice(0, TOP_PRODUCTS_N);

    return out;
  }
  ```
- [ ] Run it and confirm PASS:
  `npm --prefix dashboard-web run test -- src/lib/home/__tests__/unknownBucket.test.ts`
  Expected: PASS (green).
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/home/unknownBucket.ts dashboard-web/src/lib/home/__tests__/unknownBucket.test.ts dashboard-web/src/lib/home/adapters.ts dashboard-web/src/lib/ordersAttribution.ts dashboard-web/src/lib/postgresReaders.ts && git -C /Users/dorperetz/script-roas commit -m "feat(attribution): pure decomposition of the unknown/direct order bucket

Slices the un-attributed bucket by signals already on OrderAttributionRow
(new-vs-returning, AOV band, store, top products, payment category) without
redistributing the unknown share across channels. Also wires the existing
payment_gateway column onto the read-side row (was write/store-only).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task A.2 — `UnknownBucketPanel` component (failing DOM test first)

- [ ] Write the failing DOM test `dashboard-web/src/components/home/__tests__/unknownBucketPanel.dom.test.tsx`:
  ```tsx
  import { describe, expect, it } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { UnknownBucketPanel } from '@/components/home/UnknownBucketPanel';
  import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

  const FIXTURE: UnknownBucketBreakdown = {
    unknownOrders: 12,
    unknownRevenueCad: 840,
    newVsReturning: { new: 7, returning: 3, unclassifiable: 2 },
    aovBands: { low: 4, mid: 6, high: 2 },
    byStore: [{ store: 'Zol Plus', orders: 8 }, { store: '360usmile', orders: 4 }],
    topProducts: [{ productId: 'p1', units: 9, revenueCad: 300 }],
    byPaymentCategory: { credit: 9, paypal: 2, other: 1 },
  };

  describe('UnknownBucketPanel', () => {
    it('renders nothing when there are no unknown orders', () => {
      const { container } = render(
        <UnknownBucketPanel breakdown={{ ...FIXTURE, unknownOrders: 0 }} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('surfaces the new-vs-returning split and per-store rows', () => {
      render(<UnknownBucketPanel breakdown={FIXTURE} />);
      expect(screen.getByTestId('unknown-bucket-panel')).toBeInTheDocument();
      expect(screen.getByText('Zol Plus')).toBeInTheDocument();
      expect(screen.getByText('360usmile')).toBeInTheDocument();
    });

    it('renders revenue through a tabular, non-clipped money cell', () => {
      render(<UnknownBucketPanel breakdown={FIXTURE} />);
      const money = screen.getByTestId('unknown-bucket-revenue');
      expect(money.className).toMatch(/tabular-nums/);
    });
  });
  ```
- [ ] Run it and confirm FAIL:
  `npm --prefix dashboard-web run test:components -- src/components/home/__tests__/unknownBucketPanel.dom.test.tsx`
  Expected: FAIL (component missing).
- [ ] Minimal impl `dashboard-web/src/components/home/UnknownBucketPanel.tsx`. Token-only, light+dark, RTL logical classes, `<Money>` for CAD, `<bdi dir="ltr">` for raw counts, no native `title`. Skeleton:
  ```tsx
  'use client';

  /**
   * Drill-down of the unknown/direct order bucket (opened from the hero
   * CoverageChip). DESCRIPTIVE only — never redistributes the unknown share.
   * Token-driven, light+dark, RTL; CAD via <Money>. CAPI-safe (render-only).
   */
  import { Money } from '@/components/ui/Money';
  import { Heading } from '@/components/ui/Typography';
  import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

  export function UnknownBucketPanel({ breakdown }: { breakdown: UnknownBucketBreakdown }) {
    if (breakdown.unknownOrders === 0) return null;
    const { newVsReturning: nvr, aovBands, byStore, byPaymentCategory: pay } = breakdown;
    return (
      <section
        data-testid="unknown-bucket-panel"
        className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-ink-secondary"
        dir="rtl"
      >
        <Heading level={4} className="text-ink-primary">פירוק הבלתי-מזוהה</Heading>
        <p className="mt-1 text-ink-muted">
          {/* honest framing — these are descriptive slices, not channels */}
          <bdi dir="ltr">{breakdown.unknownOrders}</bdi> הזמנות ללא סימן ייחוס ·{' '}
          <Money data-testid="unknown-bucket-revenue" valueCad={breakdown.unknownRevenueCad} />
        </p>
        {/* New vs returning */}
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="חדשים" value={nvr.new} />
          <Stat label="חוזרים" value={nvr.returning} />
          <Stat label="לא מסווג" value={nvr.unclassifiable} />
        </dl>
        {/* AOV bands */}
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="AOV נמוך" value={aovBands.low} />
          <Stat label="AOV בינוני" value={aovBands.mid} />
          <Stat label="AOV גבוה" value={aovBands.high} />
        </dl>
        {/* Payment category */}
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="אשראי" value={pay.credit} />
          <Stat label="PayPal" value={pay.paypal} />
          <Stat label="אחר" value={pay.other} />
        </dl>
        {/* Per-store */}
        <ul className="mt-2 space-y-1">
          {byStore.map((s) => (
            <li key={s.store} className="flex items-center justify-between">
              <span className="text-ink-secondary">{s.store}</span>
              <bdi dir="ltr" className="tabular-nums text-ink-primary">{s.orders}</bdi>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  function Stat({ label, value }: { label: string; value: number }) {
    return (
      <div className="rounded-md bg-surface-1 px-2 py-1.5 text-center">
        <div className="text-[10.5px] text-ink-muted">{label}</div>
        <bdi dir="ltr" className="tabular-nums text-ink-primary">{value}</bdi>
      </div>
    );
  }
  ```
  Note: confirm the real token/class names against `CoverageChip.tsx` + an existing home panel (`bg-surface-2`/`border-border`/`text-ink-*` — substitute the project's actual tokens if these differ; `no-hex-color-in-components` + `no-physical-direction-in-components` will catch deviations). Confirm `<Money>` accepts `valueCad` vs `value` by reading `@/components/ui/Money` before writing.
- [ ] Run it and confirm PASS:
  `npm --prefix dashboard-web run test:components -- src/components/home/__tests__/unknownBucketPanel.dom.test.tsx`
- [ ] Run lint on the new component (guards): `npm --prefix dashboard-web run lint` (expect clean).
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/components/home/UnknownBucketPanel.tsx dashboard-web/src/components/home/__tests__/unknownBucketPanel.dom.test.tsx && git -C /Users/dorperetz/script-roas commit -m "feat(home): UnknownBucketPanel — descriptive drill-down of the unknown bucket

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task A.3 — Wire the panel into the hero (CoverageChip expand) + Dashboard memo

- [ ] FIRST (UI affordance is non-trivial): produce a static HTML mockup of the hero chip → expanded `UnknownBucketPanel` (both light + dark), save to `docs/superpowers/mockups/2026-06-04-unknown-bucket/unknown-bucket.html`, and deliver to the operator as an open link:
  `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-unknown-bucket/unknown-bucket.html`
  **STOP — get operator approval before building the wiring.**
- [ ] Write a failing DOM test asserting the chip exposes a disclosure that reveals the panel (extend `dashboard-web/src/components/home/__tests__/coverageChip.dom.test.tsx` — keep the existing 4 cases, add a case that, given a `breakdown` prop, renders a `data-testid="coverage-chip-expand"` trigger and on click shows `unknown-bucket-panel`). Use `@testing-library/user-event`.
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl: in `CoverageChip.tsx` add an optional `breakdown?: UnknownBucketBreakdown` prop; when present and `coverage.prominent`, wrap the chip in a `Popover`/disclosure (reuse the project's existing popover primitive — confirm by reading `src/components/ui/`; do NOT hand-roll a fixed overlay) that renders `<UnknownBucketPanel breakdown={breakdown} />`. The chip's default appearance is unchanged when no breakdown is passed (backward-compatible).
- [ ] In `Dashboard.tsx` (near the existing `coverageChip` memo at line 254-255), add:
  ```ts
  const unknownBreakdown = useMemo(
    () => decomposeUnknownBucket(ordersData?.rows ?? []),
    [ordersData],
  );
  ```
  and pass `breakdown={unknownBreakdown}` down to the hero's `CoverageChip` (thread through `CommandCenterHero`'s `coverage` prop neighborhood — add a sibling `coverageBreakdown` prop).
- [ ] Run both configs:
  `npm --prefix dashboard-web run test:components -- src/components/home/__tests__/coverageChip.dom.test.tsx`
- [ ] Update docs (`docs/ROAS-Dashboard-User-Manual.md`): add a subsection under the Home/hero area describing the expandable attribution-coverage drill-down; bump the manual version.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/components/home/CoverageChip.tsx dashboard-web/src/components/home/CommandCenterHero.tsx dashboard-web/src/components/Dashboard.tsx dashboard-web/src/components/home/__tests__/coverageChip.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md docs/superpowers/mockups/2026-06-04-unknown-bucket/unknown-bucket.html && git -C /Users/dorperetz/script-roas commit -m "feat(home): expandable attribution-coverage chip → unknown-bucket drill-down

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Feature B: Post-purchase survey ("how did you hear about us") rollup from note_attributes (gap `survey-hdyhau-rollup`)

> impact: medium · effort: M · CAPI-safe: YES (reads operator-blessed `note_attributes`; writes a DB column; sends NOTHING to any pixel/CAPI) · dependencies: none. **Operator dependency:** answers only accrue once the operator installs a survey app that writes the answer into `note_attributes`. Install the column + capture path FIRST so answers accrue from day one; the tab renders a "no responses yet" low-data state until they do.

Why: the Shopify fetcher already folds `note_attributes` into `params` (`shopify.ts:893-897`) but reads ONLY click-id / `ft_*` / `utm_*` keys (`shopify.ts:905-921`). A free-text survey answer is never captured into a column and never rolled up. This adds one nullable column, captures the answer on the existing fold (no extra fetch), dual-writes it (cronDaily + cronLive), and rolls it up into a tab — mirroring the `payment_gateway` → `PaymentMethodsTab` pipeline exactly.

### Task B.1 — Migration: `survey_source` column

- [ ] Create `supabase/migrations/20260604130000_orders_attribution_survey_source.sql`:
  ```sql
  -- Post-purchase survey ("how did you hear about us") — additive, nullable
  -- column on orders_attribution. Stores the RAW free-text answer the survey app
  -- writes into the order's note_attributes (the only first-party demand signal
  -- blessed by the CAPI constraint). Normalized to a canonical bucket in code
  -- (lib/survey.ts) so categorization stays adjustable.
  -- READ-ONLY toward Shopify (read_orders only) and toward every ad platform —
  -- nothing is ever sent to any pixel/CAPI.

  ALTER TABLE orders_attribution ADD COLUMN IF NOT EXISTS survey_source TEXT;

  COMMENT ON COLUMN orders_attribution.survey_source IS 'Raw post-purchase survey answer ("how did you hear about us") from note_attributes; normalized in code (lib/survey.ts). NULL = no survey answer captured / not yet backfilled.';
  ```
- [ ] Apply to prod using the documented procedure (only-new migrations):
  1. Hide root env so the CLI parser does not choke on dotted keys:
     `mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.hidden`
  2. Move the 2 duplicate-timestamp gap files out so `db push` does not fail on duplicate keys:
     `mkdir -p /tmp/mig-gap && mv "/Users/dorperetz/script-roas/supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql" "/Users/dorperetz/script-roas/supabase/migrations/20260530310000_agg_data_daily_for_date.sql" /tmp/mig-gap/`
  3. `supabase db push` (from repo root; new migration applies).
  4. Restore everything:
     `mv /tmp/mig-gap/* /Users/dorperetz/script-roas/supabase/migrations/ && mv /Users/dorperetz/script-roas/.env.hidden /Users/dorperetz/script-roas/.env`
  (Per the locked Supabase migration procedure in MEMORY. The two gap files are `20260530300000_phase_d_soak_cleanup_*` and `20260530310000_agg_data_daily_for_date`; the OTHER `20260530300000_recompute_data_daily_derived.sql` stays — it is the canonical one for that timestamp.)
- [ ] Verify the column exists in prod (read-only check, production DB — never localhost):
  run a one-off `select column_name from information_schema.columns where table_name='orders_attribution' and column_name='survey_source';` via the project's existing prod query path (e.g. `scripts/` runner or supabase SQL). Expect 1 row.
- [ ] Update `docs/ARCHITECTURE.md` (migration + column documented in the orders_attribution section).
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add supabase/migrations/20260604130000_orders_attribution_survey_source.sql docs/ARCHITECTURE.md && git -C /Users/dorperetz/script-roas commit -m "feat(db): add nullable orders_attribution.survey_source (post-purchase survey)

Additive, nullable. CAPI-safe: read-only Shopify note_attributes; zero
pixel/CAPI events. Applied to prod via the only-new-migrations procedure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.2 — `lib/survey.ts` extraction + normalization (failing test first)

- [ ] Write failing test `dashboard-web/src/lib/__tests__/survey.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { extractSurveyAnswer, normalizeSurveyAnswer, SURVEY_NOTE_KEYS } from '@/lib/survey';

  describe('extractSurveyAnswer', () => {
    it('returns null for empty / missing note_attributes', () => {
      expect(extractSurveyAnswer([])).toBeNull();
      expect(extractSurveyAnswer(undefined)).toBeNull();
    });
    it('reads the first matching survey key (case-insensitive name match)', () => {
      const na = [{ name: 'How did you hear about us?', value: 'TikTok' }];
      expect(extractSurveyAnswer(na)).toBe('TikTok');
    });
    it('ignores non-survey note_attributes', () => {
      const na = [{ name: '_ft_fbclid', value: 'abc' }, { name: 'gift_message', value: 'hi' }];
      expect(extractSurveyAnswer(na)).toBeNull();
    });
    it('trims and drops blank answers', () => {
      const na = [{ name: SURVEY_NOTE_KEYS[0], value: '   ' }];
      expect(extractSurveyAnswer(na)).toBeNull();
    });
  });

  describe('normalizeSurveyAnswer', () => {
    it('null/blank → null', () => {
      expect(normalizeSurveyAnswer(null)).toBeNull();
      expect(normalizeSurveyAnswer('  ')).toBeNull();
    });
    it('maps common phrasings to canonical buckets (case/space-insensitive)', () => {
      expect(normalizeSurveyAnswer('TikTok')).toBe('tiktok');
      expect(normalizeSurveyAnswer('instagram / facebook')).toBe('meta');
      expect(normalizeSurveyAnswer('Google search')).toBe('google');
      expect(normalizeSurveyAnswer('a friend told me')).toBe('word-of-mouth');
      expect(normalizeSurveyAnswer('newsletter email')).toBe('email');
    });
    it('keeps an unknown raw phrasing as the lower-cased trimmed string (never dropped)', () => {
      expect(normalizeSurveyAnswer('Billboard downtown')).toBe('billboard downtown');
    });
  });
  ```
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/survey.ts` (mirror `lib/payments.ts` shape):
  ```ts
  /**
   * Post-purchase survey ("how did you hear about us") helpers.
   *
   * The survey app writes the customer's answer into the order's
   * `note_attributes` (the only first-party demand signal blessed by the CAPI
   * constraint). We capture the RAW answer into orders_attribution.survey_source
   * and normalize to a canonical bucket here (kept in code so the mapping stays
   * adjustable). CAPI-safe: read-only; nothing is ever sent to any pixel/CAPI.
   */

  /** note_attributes names the survey app may use (matched case-insensitively). */
  export const SURVEY_NOTE_KEYS = [
    'how did you hear about us?',
    'how did you hear about us',
    'how-did-you-hear',
    'hdyhau',
    'survey_source',
    'איך שמעת עלינו',
    'איך שמעת עלינו?',
  ] as const;

  type NoteAttr = { name?: unknown; value?: unknown };

  /** Pull the raw, trimmed survey answer from note_attributes; null when none. */
  export function extractSurveyAnswer(
    noteAttrs: ReadonlyArray<NoteAttr> | undefined | null,
  ): string | null {
    if (!noteAttrs || noteAttrs.length === 0) return null;
    const keys = new Set(SURVEY_NOTE_KEYS.map((k) => k.toLowerCase()));
    for (const na of noteAttrs) {
      const name = String(na?.name ?? '').trim().toLowerCase();
      if (!name || !keys.has(name)) continue;
      const value = String(na?.value ?? '').trim();
      if (value) return value;
    }
    return null;
  }

  /**
   * Normalize a raw answer to a canonical bucket. Unknown phrasings are kept as
   * the lower-cased trimmed string (NEVER dropped) so the rollup never goes
   * blind on a new answer — the dashboard stops hiding categories.
   */
  export function normalizeSurveyAnswer(raw: string | null | undefined): string | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/tiktok|tik tok/.test(s)) return 'tiktok';
    if (/instagram|facebook|\bfb\b|\big\b|meta/.test(s)) return 'meta';
    if (/google|youtube|search/.test(s)) return 'google';
    if (/friend|word.?of.?mouth|family|חבר|המלצה/.test(s)) return 'word-of-mouth';
    if (/email|newsletter|klaviyo|mail/.test(s)) return 'email';
    return s; // preserve unknowns verbatim
  }
  ```
- [ ] Run it, confirm PASS.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/survey.ts dashboard-web/src/lib/__tests__/survey.test.ts && git -C /Users/dorperetz/script-roas commit -m "feat(survey): note_attributes extraction + canonical normalization helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.3 — Capture `surveySource` in the Shopify fetcher (failing test first)

- [ ] Write a failing test (add to the existing `dashboard-web/src/lib/fetchers/__tests__/shopify.test.ts` or a new focused file). Assert that `classifyOrderAttribution` (or the order-record builder it feeds) populates `surveySource` from a `note_attributes` survey answer and `null` otherwise. Read the existing test's harness for how it invokes the classifier (the file already imports the fetcher; mirror an existing `note_attributes`-driven case such as the `_ft_*` first-click tests).
  ```ts
  it('captures the post-purchase survey answer from note_attributes', () => {
    const order = {
      id: 1, total_price: '50', created_at: '2026-06-01T10:00:00+03:00',
      note_attributes: [{ name: 'How did you hear about us?', value: 'TikTok' }],
    } as any;
    const c = classifyOrderAttribution(order);
    expect(c.surveySource).toBe('TikTok'); // RAW; normalization happens at read time
  });
  it('survey answer is null when absent', () => {
    const order = { id: 2, total_price: '50', note_attributes: [] } as any;
    expect(classifyOrderAttribution(order).surveySource).toBeNull();
  });
  ```
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl in `dashboard-web/src/lib/fetchers/shopify.ts`:
  - Import the helper near the top: `import { extractSurveyAnswer } from '@/lib/survey';` (confirm import style/path used in this file).
  - In `classifyOrderAttribution`, AFTER the `noteAttrs` is read (line 876) compute `const surveySource = extractSurveyAnswer(noteAttrs);` and add `surveySource` to the return object + the function's return TYPE (add `surveySource: string | null;` alongside `firstSeenAt: string | null;` at ~line 871).
  - In the order-record `OrderAttributionRecord` type (~line 246-251, after `paymentGateway`), add `surveySource: string | null;`.
  - In the `out.push({...})` builder (~line 1224), add `surveySource: classified.surveySource,` after `paymentGateway: ...`.
- [ ] Run it, confirm PASS:
  `npm --prefix dashboard-web run test -- src/lib/fetchers/__tests__/shopify.test.ts`
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/fetchers/shopify.ts dashboard-web/src/lib/fetchers/__tests__/shopify.test.ts && git -C /Users/dorperetz/script-roas commit -m "feat(survey): capture post-purchase survey answer from note_attributes in fetcher

No extra fetch — reads from the already-folded note_attributes. CAPI-safe.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.4 — Dual-write through `toOrdersAttributionRow` (failing test first)

- [ ] Write a failing test in `dashboard-web/src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts` (the existing dual-write key test — extend it) asserting `ordersAttributionRowKeys()` includes `'survey_source'` and `toOrdersAttributionRow({... surveySource: 'TikTok'})` emits `survey_source: 'TikTok'` and `null` when omitted-as-null.
  ```ts
  it('dual-writes survey_source', () => {
    expect(ordersAttributionRowKeys()).toContain('survey_source');
    const row = toOrdersAttributionRow({ ...BASE_INPUT, surveySource: 'TikTok' });
    expect(row.survey_source).toBe('TikTok');
    expect(toOrdersAttributionRow({ ...BASE_INPUT, surveySource: null }).survey_source).toBeNull();
  });
  ```
  (Reuse the file's existing `BASE_INPUT`/exemplar object if present; otherwise build the full input like `ordersAttributionRowKeys`'s exemplar.)
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl in `dashboard-web/src/inngest/functions/cronDaily.ts`:
  - Add `survey_source: string | null;` to the `OrderAttributionUpsertRow` type (alongside `payment_gateway` at line 140).
  - Add `surveySource: string | null;` to the `toOrdersAttributionRow` param object (after `paymentGateway` at line 172).
  - Add `survey_source: o.surveySource ?? null,` to the returned object (after `payment_gateway` at line 203).
  - Add `surveySource: null,` to the `ordersAttributionRowKeys()` exemplar (after `paymentGateway: null,` at line 238).
  - `cronDaily` (line 1647) and `cronLive` (line 685) both call `toOrdersAttributionRow(o)` over the fetcher orders — both already carry `surveySource` from Task B.3, so the dual-write is automatic. Confirm no compile errors at both call sites.
- [ ] Run it, confirm PASS:
  `npm --prefix dashboard-web run test -- src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts`
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/inngest/functions/cronDaily.ts dashboard-web/src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts && git -C /Users/dorperetz/script-roas commit -m "feat(survey): dual-write survey_source via toOrdersAttributionRow (cronDaily+cronLive)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.5 — Read-side passthrough + `readSurveyRollup` aggregate (failing test first)

- [ ] Write failing test `dashboard-web/src/lib/__tests__/postgresReadersSurvey.test.ts`. Mirror `postgresReadersPaymentMethods.test.ts` (read it first for the supabase mock shape). Assert:
  - `SURVEY_ROLLUP_SELECT` includes `survey_source`, `store_id`, `total_cad`, `date`.
  - `readSurveyRollup()` groups by normalized answer × store (DISPLAY name), counting orders + summing `total_cad`, AND reports `respondedOrders` vs `totalOrders` (the response rate), with a `nullAnswer` bucket excluded from the answer split but counted in `totalOrders`.
  - Keys are display names via `STORE_NAME_BY_ID` (the 2026-06-04 store-keying lesson).
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl in `dashboard-web/src/lib/postgresReaders.ts`:
  - Add `, survey_source` to `ORDERS_ATTRIBUTION_SELECT` (so the per-order row reader can also surface it). Add `surveySource: r.survey_source == null ? null : String(r.survey_source).trim() || null,` to the `OrderAttributionRow` map (right after the `paymentGateway` line added in Task A.1) AND add `surveySource: string | null;` to `OrderAttributionRow` in `ordersAttribution.ts` (after `paymentGateway`).
  - Add the aggregate reader, mirroring `readPaymentMethodsByMonth` (line 1297) but grouped by normalized answer (not month):
    ```ts
    // ────────────────────────────────────────────────────────────────────────
    // 7d. readSurveyRollup — orders_attribution.survey_source rollup
    //     Post-purchase survey ("how did you hear about us"). Business-wide +
    //     per-store split of responses by NORMALIZED answer, plus a response
    //     rate (responded ÷ total). CAPI-safe: pure Shopify reporting aggregate.
    // ────────────────────────────────────────────────────────────────────────
    export const SURVEY_ROLLUP_SELECT = 'store_id, date, total_cad, survey_source';

    export type SurveyBucket = { orders: number; revenueCad: number };
    export type SurveyScopeTotals = {
      byAnswer: Record<string, SurveyBucket>; // normalized answer → bucket
      respondedOrders: number;                // orders WITH a non-null answer
      totalOrders: number;                    // all orders (incl. no answer)
    };
    export type SurveyRollup = {
      business: SurveyScopeTotals;
      perStore: Record<string, SurveyScopeTotals>; // keyed by DISPLAY name
    };

    function emptySurveyScope(): SurveyScopeTotals {
      return { byAnswer: {}, respondedOrders: 0, totalOrders: 0 };
    }

    export async function readSurveyRollup(): Promise<SurveyRollup> {
      let data: DbRow[];
      try {
        data = await paginate<DbRow>(() =>
          getSupabase().from('orders_attribution').select(SURVEY_ROLLUP_SELECT),
        );
      } catch (e) {
        throw new Error(`postgresReaders.readSurveyRollup: ${(e as Error).message}`);
      }
      const out: SurveyRollup = { business: emptySurveyScope(), perStore: {} };
      for (const r of data) {
        const storeId = String(r.store_id);
        const storeKey = STORE_NAME_BY_ID[storeId] ?? storeId;
        const revenueCad = toNumber(r.total_cad);
        const answer = normalizeSurveyAnswer(
          r.survey_source == null ? null : String(r.survey_source),
        );
        let store = out.perStore[storeKey];
        if (!store) { store = emptySurveyScope(); out.perStore[storeKey] = store; }
        store.totalOrders += 1;
        out.business.totalOrders += 1;
        if (answer != null) {
          store.respondedOrders += 1;
          out.business.respondedOrders += 1;
          const sb = store.byAnswer[answer] ?? (store.byAnswer[answer] = { orders: 0, revenueCad: 0 });
          sb.orders += 1; sb.revenueCad += revenueCad;
          const bb = out.business.byAnswer[answer] ?? (out.business.byAnswer[answer] = { orders: 0, revenueCad: 0 });
          bb.orders += 1; bb.revenueCad += revenueCad;
        }
      }
      return out;
    }
    ```
  - Add `import { normalizeSurveyAnswer } from '@/lib/survey';` near the existing `import { categorizePaymentGateway, ... } from './payments';` (line 45). Use relative or alias import consistent with that file (it uses `./payments`, so use `./survey`).
- [ ] Run both: `npm --prefix dashboard-web run test -- src/lib/__tests__/postgresReadersSurvey.test.ts`
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/postgresReaders.ts dashboard-web/src/lib/ordersAttribution.ts dashboard-web/src/lib/__tests__/postgresReadersSurvey.test.ts && git -C /Users/dorperetz/script-roas commit -m "feat(survey): read-side passthrough + readSurveyRollup aggregate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.6 — `/api/survey` route

- [ ] Create `dashboard-web/src/app/api/survey/route.ts`, mirroring `/api/payment-methods/route.ts` exactly (60s revalidate, degraded empty-rollup path, `captureRouteError('survey', err)`, behind the dashboard auth gate by default — do NOT add it to `isDashboardAuthAllowlisted`; it is an internal GET):
  ```ts
  import { NextResponse } from 'next/server';
  import type { SurveyRollup } from '@/lib/postgresReaders';
  import { readSurveyRollup } from '@/lib/postgresReaders';
  import { cacheControl } from '@/lib/cacheConfig';
  import { captureRouteError } from '@/lib/sentry/capture';

  export const revalidate = 60; // matches the orders_attribution write cadence

  export type SurveyResponse = SurveyRollup & {
    lastUpdated: string;
    error?: string;
  };

  export async function GET() {
    try {
      const result = await readSurveyRollup();
      return NextResponse.json(
        { ...result, lastUpdated: new Date().toISOString() } satisfies SurveyResponse,
        { headers: { 'Cache-Control': cacheControl('paymentMethods') } },
      );
    } catch (err) {
      captureRouteError('survey', err);
      const empty: SurveyRollup = { business: { byAnswer: {}, respondedOrders: 0, totalOrders: 0 }, perStore: {} };
      return NextResponse.json(
        { ...empty, lastUpdated: new Date().toISOString(), error: 'survey fetch failed' } satisfies SurveyResponse,
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  ```
  Note: confirm whether `cacheConfig` needs a dedicated `survey` key (read `@/lib/cacheConfig`); if it has a typed allowlist of keys, add a `survey` entry mirroring `paymentMethods` and use `cacheControl('survey')`. If `cacheControl` accepts any string, reuse `'paymentMethods'`.
- [ ] No new unit test required for the route (it is thin glue; the reader is tested). Confirm typecheck: `npx --prefix dashboard-web tsc --noEmit -p dashboard-web/tsconfig.json`.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/app/api/survey/route.ts dashboard-web/src/lib/cacheConfig.ts && git -C /Users/dorperetz/script-roas commit -m "feat(survey): /api/survey route (rollup, degraded empty path, auth-gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.7 — `SurveyTab` UI (mockup → approval → build)

- [ ] FIRST: produce a static HTML mockup of the survey tab (business + per-store answer split, response-rate chip, "no responses yet" low-data state), both light + dark, save to `docs/superpowers/mockups/2026-06-04-survey/survey-tab.html`, deliver as:
  `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-survey/survey-tab.html`
  **STOP — get operator approval before building.**
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/SurveyTab.dom.test.tsx`. Mirror `PaymentMethodsTab.dom.test.tsx` (read it for the `injectedData` bypass convention). Assert:
  - With injected empty rollup → renders the low-data "no responses yet" state (no crash).
  - With an injected rollup → renders the answer rows + a response-rate value through a tabular cell, and CAD via a `tabular-nums` money cell.
  - Scope switch (business / per-store) re-renders over the held dataset.
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl `dashboard-web/src/components/SurveyTab.tsx`. Port the approved mockup using the existing graphic language (Card / Heading / NativeSelect / Money / TableBase / SectionIntro — same imports as `PaymentMethodsTab`). Token-only, light+dark, RTL logical classes, `<Money>` for CAD, `<bdi dir="ltr">` for counts/percentages, `HelpTooltip` for the response-rate explainer. SWR from `/api/survey` with an `injectedData?: SurveyRollup` test bypass prop. Honest framing: the answer split is a DEMAND signal (not a redistribution of attribution); response-rate is shown so partial coverage is never read as the whole truth.
- [ ] Run it, confirm PASS:
  `npm --prefix dashboard-web run test:components -- src/components/__tests__/SurveyTab.dom.test.tsx`
- [ ] Lint: `npm --prefix dashboard-web run lint`.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/components/SurveyTab.tsx dashboard-web/src/components/__tests__/SurveyTab.dom.test.tsx docs/superpowers/mockups/2026-06-04-survey/survey-tab.html && git -C /Users/dorperetz/script-roas commit -m "feat(survey): SurveyTab — survey-answer rollup with honest response-rate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.8 — Register the survey tab (TabKey + Sidebar + Dashboard)

- [ ] In `dashboard-web/src/lib/urlState.ts`: add `| 'survey'` to `TabKey` (line 24-33) and `'survey'` to the `TAB_VALUES` set (line 36-37).
- [ ] In `dashboard-web/src/components/Sidebar.tsx`: add a tab entry mirroring the `payments` one, e.g. (pick the right lucide icon, e.g. `MessageSquare`, and a free slot number):
  ```tsx
  { key: 'survey',    label: 'סקר מקור',           icon: <MessageSquare size={16} />, slot: 11 },
  ```
  (Import `MessageSquare` from `lucide-react` in the existing import group at line 7.)
- [ ] In `dashboard-web/src/components/Dashboard.tsx`: add a render branch after the `payments` branch (line 658-660):
  ```tsx
  {activeTab === 'survey' && (
    <SurveyTab stores={data.stores} globalStore={filters.store} />
  )}
  ```
  and import `SurveyTab` near the `PaymentMethodsTab` import (line 75).
- [ ] Write/extend a DOM test asserting the Sidebar renders the new 'סקר מקור' entry and `onTabChange('survey')` fires (mirror the existing sidebar tab test if one exists; otherwise add a focused assertion to `SurveyTab.dom.test.tsx`'s sibling). Confirm typecheck passes.
- [ ] Run both configs: `npm --prefix dashboard-web run test:components`
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — new "סקר מקור (Post-purchase survey)" tab section + version bump. Note the operator action: the answers only populate once the survey app writes `note_attributes` matching `SURVEY_NOTE_KEYS`.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/urlState.ts dashboard-web/src/components/Sidebar.tsx dashboard-web/src/components/Dashboard.tsx docs/ROAS-Dashboard-User-Manual.md && git -C /Users/dorperetz/script-roas commit -m "feat(survey): register survey tab (TabKey + Sidebar + Dashboard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task B.9 — Backfill runner (one-time, documented, NOT auto-run)

- [ ] Create `scripts/backfillSurveySource.ts` mirroring `scripts/backfillRecentAttribution.ts` (read it first for the page-and-upsert harness): iterate stored Shopify orders over a date window, re-extract `survey_source` via `extractSurveyAnswer(order.note_attributes)`, and UPDATE existing `orders_attribution` rows by `(store_id, order_id)`. Idempotent (only sets `survey_source`; touches no other column). Add a header comment that it is run ONCE after the survey app is installed, against PROD, and is not wired to any cron.
- [ ] No new vitest case (script harness); confirm `npx --prefix dashboard-web tsc --noEmit` passes.
- [ ] Update `docs/ARCHITECTURE.md` (backfill runner documented next to the migration).
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add scripts/backfillSurveySource.ts docs/ARCHITECTURE.md && git -C /Users/dorperetz/script-roas commit -m "feat(survey): one-time backfill runner for survey_source (documented, not auto-run)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Feature C: Spend-pause / organic-baseline incrementality proxy (gap `organic-baseline-incrementality-proxy`)

> impact: medium · effort: L · CAPI-safe: YES (pure compute over stored `data_daily`; zero pixel/CAPI; no geo-holdout, no test traffic) · dependencies: none. **MUST ship with an explicit abstain state** when there are not enough clean low-spend baseline days — never a hard number.

Why: there is no incrementality signal anywhere. The window-stability / MAD-outlier logic (`attributionAnalysis.ts:645-761`) is a TRUST/volatility signal, not a lift estimate. A full geo/holdout test is out of scope for one operator, but a lightweight proxy is feasible from `data_daily` (per-platform spend + revenue per day, deep-backfilled to 2023). Compare Shopify revenue on naturally-occurring near-zero-spend days against high-spend days for the SAME store to estimate the organic baseline (revenue with ~no ads) and therefore the incremental share of spend-on days. The estimate is fragile, so the function MUST abstain (with an explicit reason) when the clean baseline is too thin.

### Task C.1 — Pure `incrementality.ts` proxy with abstain (failing test first)

- [ ] Write failing test `dashboard-web/src/lib/analytics/__tests__/incrementality.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    estimateOrganicBaseline,
    MIN_CLEAN_BASELINE_DAYS,
    LOW_SPEND_FRACTION,
  } from '../incrementality';
  import type { DailyRow } from '@/lib/types';

  function day(over: Partial<DailyRow>): DailyRow {
    return {
      date: '2026-01-01', storeId: 'uzoshop', storeName: 'uzoshop',
      fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 0, roas: 0,
      grossProfit: 0, cogs: 0, netProfit: 0, hasCogs: false, grossRevenue: null,
      refundDeduction: null, fbImpressions: null, gaImpressions: null, ttImpressions: null,
      ...over,
    };
  }

  describe('estimateOrganicBaseline', () => {
    it('ABSTAINS with too-few-baseline-days when there is no low-spend history', () => {
      // all high-spend days → zero clean baseline days
      const rows = Array.from({ length: 30 }, (_, i) =>
        day({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, totalSpend: 1000, revenue: 5000 }),
      );
      const r = estimateOrganicBaseline(rows, 'uzoshop');
      expect(r.status).toBe('abstain');
      if (r.status === 'abstain') expect(r.reason).toBe('insufficient-clean-baseline-days');
    });

    it('ABSTAINS when low-spend days exist but fewer than the minimum', () => {
      const rows = [
        ...Array.from({ length: MIN_CLEAN_BASELINE_DAYS - 1 }, (_, i) =>
          day({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, totalSpend: 0, revenue: 800 })),
        ...Array.from({ length: 20 }, (_, i) =>
          day({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, totalSpend: 2000, revenue: 6000 })),
      ];
      const r = estimateOrganicBaseline(rows, 'uzoshop');
      expect(r.status).toBe('abstain');
    });

    it('estimates baseline + incremental share when there is a clean baseline', () => {
      const baselineDays = Array.from({ length: MIN_CLEAN_BASELINE_DAYS + 2 }, (_, i) =>
        day({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, totalSpend: 0, revenue: 1000 }));
      const spendDays = Array.from({ length: 20 }, (_, i) =>
        day({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, totalSpend: 2000, revenue: 4000 }));
      const r = estimateOrganicBaseline([...baselineDays, ...spendDays], 'uzoshop');
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        expect(r.baselineRevenuePerDayCad).toBeCloseTo(1000);
        // spend-on days average 4000; ~1000 is organic → ~3000 incremental → 75%
        expect(r.incrementalSharePct).toBeGreaterThan(70);
        expect(r.incrementalSharePct).toBeLessThanOrEqual(100);
        expect(r.cleanBaselineDays).toBeGreaterThanOrEqual(MIN_CLEAN_BASELINE_DAYS);
      }
    });

    it('scopes to the requested store only (mapping-aware data_daily input)', () => {
      const rows = [
        day({ storeId: 'uzoshop', storeName: 'uzoshop', totalSpend: 0, revenue: 9999 }),
        day({ storeId: 'zolplus', storeName: 'Zol Plus', totalSpend: 0, revenue: 1 }),
      ];
      const r = estimateOrganicBaseline(rows, 'Zol Plus');
      // only the Zol Plus row participates; still abstains (1 < min) but never
      // mixes uzoshop revenue in.
      expect(r.status).toBe('abstain');
    });

    it('never returns a fabricated number on the abstain path', () => {
      const r = estimateOrganicBaseline([], 'uzoshop');
      expect(r.status).toBe('abstain');
      expect((r as Record<string, unknown>).incrementalSharePct).toBeUndefined();
    });
  });
  ```
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/analytics/incrementality.ts`:
  ```ts
  /**
   * Spend-pause / organic-baseline INCREMENTALITY PROXY (no geo-holdout).
   *
   * From data_daily (mapping-aware per-store spend + revenue per day), split a
   * store's days into a LOW-SPEND ("baseline") set and a HIGH-SPEND set, estimate
   * the organic baseline revenue/day (revenue with ~no ads) from the baseline
   * set's MEDIAN, and from it the incremental share of revenue on spend-on days.
   *
   * This is a PROXY, not a lift test. It is fragile when the clean baseline is
   * thin, so it ABSTAINS (explicit reason, never a fabricated number) below
   * MIN_CLEAN_BASELINE_DAYS. CAPI-safe: pure compute over stored data; zero
   * pixel/CAPI events; no test traffic.
   *
   * Input is DailyRow[] (data_daily via the mapping-aware reader) — never raw
   * account totals. Scope by store DISPLAY name (matches data.stores / filters).
   */
  import type { DailyRow } from '@/lib/types';

  /** A day counts as "low-spend baseline" when totalSpend ≤ this fraction of the
   *  store's median spend-on-day spend (i.e. effectively a near-paused day). */
  export const LOW_SPEND_FRACTION = 0.1;
  /** Minimum clean baseline days required to emit an estimate (else abstain). */
  export const MIN_CLEAN_BASELINE_DAYS = 5;

  export type IncrementalityResult =
    | {
        status: 'ok';
        store: string;
        baselineRevenuePerDayCad: number;
        spendDayRevenuePerDayCad: number;
        incrementalSharePct: number; // 0..100
        cleanBaselineDays: number;
        spendDays: number;
      }
    | {
        status: 'abstain';
        store: string;
        reason: 'insufficient-clean-baseline-days' | 'no-data';
        cleanBaselineDays: number;
      };

  function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length;
    return m % 2 === 0 ? (s[m / 2 - 1] + s[m / 2]) / 2 : s[Math.floor(m / 2)];
  }

  export function estimateOrganicBaseline(
    rows: readonly DailyRow[],
    store: string,
  ): IncrementalityResult {
    const scoped = rows.filter(
      (r) => r.storeName === store || r.storeId === store,
    );
    if (scoped.length === 0) {
      return { status: 'abstain', store, reason: 'no-data', cleanBaselineDays: 0 };
    }

    const spendVals = scoped.map((r) => (Number.isFinite(r.totalSpend) ? r.totalSpend : 0));
    const spendOnDays = scoped.filter((_, i) => spendVals[i] > 0);
    const medSpendOn = median(spendOnDays.map((r) => r.totalSpend));
    const lowThreshold = medSpendOn * LOW_SPEND_FRACTION;

    // Clean baseline = near-zero-spend days with a finite, non-negative revenue.
    const baseline = scoped.filter(
      (r) => (Number.isFinite(r.totalSpend) ? r.totalSpend : 0) <= lowThreshold &&
        Number.isFinite(r.revenue) && r.revenue >= 0,
    );
    const cleanBaselineDays = baseline.length;

    if (cleanBaselineDays < MIN_CLEAN_BASELINE_DAYS || spendOnDays.length === 0) {
      return {
        status: 'abstain',
        store,
        reason: 'insufficient-clean-baseline-days',
        cleanBaselineDays,
      };
    }

    const baselineRevenuePerDayCad = median(baseline.map((r) => r.revenue));
    const spendDayRevenuePerDayCad = median(spendOnDays.map((r) => r.revenue));
    // Incremental share = (spend-day revenue − organic baseline) ÷ spend-day
    // revenue, clamped to [0, 100]. A baseline ≥ spend-day revenue ⇒ 0% (ads
    // appear non-incremental on this proxy).
    const incremental = spendDayRevenuePerDayCad <= 0
      ? 0
      : Math.max(0, Math.min(100,
          ((spendDayRevenuePerDayCad - baselineRevenuePerDayCad) / spendDayRevenuePerDayCad) * 100));

    return {
      status: 'ok',
      store,
      baselineRevenuePerDayCad,
      spendDayRevenuePerDayCad,
      incrementalSharePct: incremental,
      cleanBaselineDays,
      spendDays: spendOnDays.length,
    };
  }
  ```
- [ ] Run it, confirm PASS:
  `npm --prefix dashboard-web run test -- src/lib/analytics/__tests__/incrementality.test.ts`
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/lib/analytics/incrementality.ts dashboard-web/src/lib/analytics/__tests__/incrementality.test.ts && git -C /Users/dorperetz/script-roas commit -m "feat(incrementality): organic-baseline proxy from data_daily with explicit abstain

Median low-spend baseline vs spend-on days → incremental share. ABSTAINS
(insufficient-clean-baseline-days) below the minimum — never a fabricated number.
CAPI-safe; mapping-aware data_daily input only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task C.2 — `IncrementalityProxyPanel` component (mockup → approval → build)

- [ ] FIRST: produce a static HTML mockup of the panel showing BOTH the estimate state AND the abstain state ("not enough no-spend days yet to estimate organic baseline"), both light + dark, save to `docs/superpowers/mockups/2026-06-04-incrementality/incrementality.html`, deliver:
  `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-incrementality/incrementality.html`
  **STOP — get operator approval before building.**
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/IncrementalityProxyPanel.dom.test.tsx`:
  - Abstain result → renders the explicit abstain copy (Hebrew "אין מספיק ימים ללא הוצאה…"), shows NO percentage number, and a `data-testid="incrementality-abstain"`.
  - ok result → renders the incremental-share value through a tabular cell + baseline CAD through `<Money>`, plus a "proxy / not a holdout test" honest caveat via `HelpTooltip`.
- [ ] Run it, confirm FAIL.
- [ ] Minimal impl `dashboard-web/src/components/IncrementalityProxyPanel.tsx`. Props: `{ result: IncrementalityResult }`. Token-only, light+dark, RTL logical classes, `<Money>` for CAD, `<bdi dir="ltr">` for the percentage, `HelpTooltip` carrying the proxy caveat ("הערכה גסה, לא מבחן holdout"). The abstain branch is first-class (not an error state) — muted, explanatory, no number.
- [ ] Run it, confirm PASS:
  `npm --prefix dashboard-web run test:components -- src/components/__tests__/IncrementalityProxyPanel.dom.test.tsx`
- [ ] Lint: `npm --prefix dashboard-web run lint`.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/components/IncrementalityProxyPanel.tsx dashboard-web/src/components/__tests__/IncrementalityProxyPanel.dom.test.tsx docs/superpowers/mockups/2026-06-04-incrementality/incrementality.html && git -C /Users/dorperetz/script-roas commit -m "feat(incrementality): IncrementalityProxyPanel — estimate + first-class abstain state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

### Task C.3 — Mount the panel on the מגמות (trends) tab

- [ ] Identify the trends container rendered for `activeTab === 'trends'` in `Dashboard.tsx` (line 649-651). Read it to find the component file name (e.g. `TrendsTab.tsx` / `TrendsView.tsx`).
- [ ] In that trends component, compute the per-store (and/or business) estimate from the daily rows it already holds. The trends view consumes `DailyRow[]` (mapping-aware `data_daily` from `/api/data`) — pass the relevant store's rows to `estimateOrganicBaseline(rows, scopeStoreOrBusiness)`. For the business scope, run per-store and present per-store cards (the proxy is per-store by design; do NOT sum baselines across stores). Confirm the rows used are the mapping-aware `DailyRow[]` (never a raw account total).
- [ ] Write/extend a DOM test on the trends component asserting the `IncrementalityProxyPanel` mounts and shows the abstain state given thin data (mirror an existing trends test if present; otherwise a focused render).
- [ ] Run both configs.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — trends-tab "אומדן אינקרמנטליות (proxy)" subsection, explicitly noting the abstain semantics and that it is NOT a holdout test; bump version. Update `docs/ARCHITECTURE.md` — the new `lib/analytics/incrementality.ts` compute + its `data_daily` input.
- [ ] Commit:
  `git -C /Users/dorperetz/script-roas add dashboard-web/src/components/<TrendsComponent>.tsx docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md && git -C /Users/dorperetz/script-roas commit -m "feat(incrementality): mount organic-baseline proxy on the trends tab (per-store)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Final gate task (run once, after all features)

### Task Z — Full gate sweep + docs-currency confirmation

- [ ] `npx --prefix dashboard-web tsc --noEmit -p dashboard-web/tsconfig.json` → 0 errors.
- [ ] `npm --prefix dashboard-web run test` → all green.
- [ ] `npm --prefix dashboard-web run test:components` → all green.
- [ ] `npm --prefix dashboard-web run lint` → 0 errors (confirm `no-physical-direction-in-components`, `no-native-title-tooltip`, `no-hex-color-in-components`, `no-emoji-in-jsx` all clean on every new component).
- [ ] Confirm docs-currency: User Manual has new sections for the unknown-bucket drill-down, the survey tab, and the incrementality proxy (with version bumps); ARCHITECTURE has the migration + survey reader/dual-write + incrementality compute.
- [ ] Do NOT push. Report the commit range to the operator and await the "push" instruction (deploy = `git push origin main` only).

---

## Self-Review

**Spec coverage** — every gap id is its own Feature with full bite-sized TDD tasks:
- `unknown-bucket-decomposition` → Feature A (A.1 pure decomposition + the missing `paymentGateway` read-side passthrough, A.2 panel, A.3 hero wiring + mockup gate). Slices the bucket by `isFirstOrder`, `totalCad` (AOV bands), `storeName`, `lineItems` (top products), `paymentGateway` — exactly the fields the audit named — and never redistributes the unknown share (reuses the SAME `hasAttributionSignal` predicate as the chip).
- `survey-hdyhau-rollup` → Feature B (B.1 migration + apply procedure, B.2 helpers, B.3 fetcher capture on the existing note_attributes fold, B.4 dual-write, B.5 reader + aggregate, B.6 route, B.7 tab, B.8 registration, B.9 backfill). End-to-end mirror of the `payment_gateway` → `PaymentMethodsTab` pipeline; column installed FIRST so answers accrue immediately; raw stored, normalized in code with unknowns preserved verbatim.
- `organic-baseline-incrementality-proxy` → Feature C (C.1 pure proxy with explicit abstain, C.2 panel with first-class abstain render, C.3 trends mount). Reads mapping-aware `DailyRow[]` only; ABSTAINS with `insufficient-clean-baseline-days` below `MIN_CLEAN_BASELINE_DAYS`; never emits a fabricated number (tested explicitly).

**CAPI-safe** — confirmed for all three: A is pure compute over stored fields; B reads operator-blessed `note_attributes` and writes a DB column (no pixel/CAPI send, no Triple-Pixel/Sonar/multi-touch); C is pure compute over `data_daily` with no test traffic and no geo-holdout. Each migration/new file carries the explicit CAPI-safe comment.

**Placeholder scan** — no `TODO`, no "similar to Task N", no pseudo-code stand-ins. Every task cites real files + real line ranges (verified by reading) and shows real code. The few "confirm X before writing" notes are deliberate (token names, `<Money>` prop name, popover primitive, exact trends component filename, `cacheConfig` key shape) because they depend on a local read the executor must do; they are not placeholders for logic.

**Type consistency** — `OrderAttributionRow` gains `paymentGateway` (A.1) and `surveySource` (B.5) symmetrically across the writer record (`shopify.ts`), the upsert mapper (`cronDaily.ts`), the select string + row map (`postgresReaders.ts`), and the read type (`ordersAttribution.ts`) — the same four-point chain the existing `payment_gateway` / `first_*` columns follow, so the select-string presence guard and dual-write-keys test both stay satisfied. `IncrementalityResult` is a discriminated union on `status` so the abstain path is type-checked to carry no estimate fields (the "never fabricated" test asserts this at runtime too). All new aggregate readers reuse `STORE_NAME_BY_ID` display-name keying (the 2026-06-04 store-keying lesson) and `paginate()` (the db-max-rows cap lesson).

## Open questions for the operator
1. **Survey app + note_attributes key.** Which survey app will you install, and what EXACT `note_attributes` name will it write? `SURVEY_NOTE_KEYS` (Task B.2) is a best-guess allowlist (English + Hebrew variants). Confirm the real key so we pin it; until then the tab shows "no responses yet". (No answers can accrue before this is installed.)
2. **AOV band edges.** Feature A uses low `<50` / mid `50–120` / high `>120` CAD (aligned with the home AOV rules in MEMORY: `>70` green / `<50` red). Are these the bands you want for the unknown-bucket slice, or should mid follow the `50–70` home convention?
3. **Incrementality thresholds.** `LOW_SPEND_FRACTION = 0.1` (a "near-paused" day is ≤10% of median spend-on-day spend) and `MIN_CLEAN_BASELINE_DAYS = 5`. Given the 2023 backfill, 5 may be too lenient (a handful of low-spend days is noisy). Do you want a higher minimum (e.g. 8–10) before the proxy stops abstaining?
4. **Incrementality scope/window.** Should the proxy run over the selected date range, the full all-history extent (more baseline days, more stable — like `computeStableNcac`), or both? And per-store only, or also a (clearly-labeled per-store, not summed) business roll-up?
5. **Unknown-bucket drill-down placement.** Expand-from-the-hero-chip (planned) vs a dedicated card lower on Home. The mockup (Task A.3) will show the chip-expand version for approval first.
