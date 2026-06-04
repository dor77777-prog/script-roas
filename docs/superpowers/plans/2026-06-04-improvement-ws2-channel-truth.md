# Channel-Level Truth (NC-ROAS / net / overcount by channel) Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Take the three truth-signals the dashboard already computes at the BLENDED / per-STORE / per-CAMPAIGN level — NC-ROAS/nCAC, the net-profit P&L cascade, and the platform-claim-vs-click-ID-verified overcount — and add a **per-acquiring-channel axis** (Meta vs Google vs TikTok) so the operator can finally answer "which channel actually acquires new customers profitably, makes money after product cost, and how much does each one overcount." Plus stub the per-channel CAC payback curve (deferred — cohorts predate reliable channel attribution).

Architecture: Pure compute adapters under `src/lib/home/` and `src/lib/` (no IO, unit-testable without a React tree), rendered by existing Home/P&L/Drawer surfaces. EVERY new per-channel number is derived from the SAME mapping-aware sources the dashboard already trusts:
- new-customer revenue/orders by channel ← `OrderAttributionRow.source` (`'meta-paid'`/`'google-paid'`/`'tiktok-paid'`), the deterministic click-ID-verified acquiring label that already lives on every order row.
- per-channel spend ← the mapping-aware `campaignRows[].spend` accumulated per `normalizePlatform(platform)` (the EXACT `platformAccum` pattern in `storeDetail.ts:193-218`), NEVER `data_daily.fbSpend/gaSpend/ttSpend` (those are raw account totals).
- per-channel platform-claim ← `campaignRows[].conversionValue` summed per platform; per-channel click-ID-verified ← `analyzeAttribution(...).deterministicRevenue` rolled up across every campaign of that platform.

Tech Stack: Next.js 15 + TypeScript (strict), Hebrew RTL, vitest (node default + dom via `vitest.config.dom.ts`), Tailwind token system (`text-chart-meta/google/tiktok`, `text-ink-*`, `bg-status-*`), shared primitives (`Money`, `PlatformBadge`, `Card`, `HelpTooltip`, `CountUp`). Deploy = `git push` to main only. Supabase migrations at repo-root `supabase/migrations/`.

CAPI-safe / READ-ONLY guarantee (applies to EVERY task below): this workstream is pure reporting. It NEVER sends an event to a pixel/CAPI/Sonar/Triple-Pixel, never does multi-touch or first-touch-via-pixel. The only demand signal it reads is the deterministic click-ID acquiring `source` already written to `orders_attribution` and the platform-reported `conversion_value` already in `campaigns_daily`. No new write path of any kind to any ad platform.

---

## File Structure

### New files (one responsibility each)
| File | Responsibility |
|------|----------------|
| `src/lib/home/channelTruth.ts` | Pure compute: the channel axis. Maps `OrderAttributionRow.source` → paid channel; splits new-customer revenue/orders by channel; per-channel NC-ROAS/nCAC (Feature 1), per-channel net profit cascade (Feature 2), per-channel overcount delta (Feature 4 roll-up wrapper around `analyzeAttribution`). One module so the channel-key mapping has ONE source of truth. |
| `src/lib/home/__tests__/channelTruth.test.ts` | Node unit tests for every export of `channelTruth.ts`. |
| `src/components/home/ChannelTruthPanel.tsx` | Presentational per-channel table/cards (NC-ROAS·nCAC·net·overcount columns) rendered in the hero region + store modal. Token-driven, light+dark, RTL, `Money`/`PlatformBadge`, WCAG-AA. |
| `src/components/home/__tests__/ChannelTruthPanel.dom.test.tsx` | DOM tests (render, RTL, empty/suppressed states, AA token usage). |
| `docs/superpowers/mockups/2026-06-04-channel-truth/channel-truth.html` | Static approval mockup (Task 0). |

### Modified files
| File | Change |
|------|--------|
| `src/lib/home/newCustomerMetrics.ts` | Add optional `source` filter param to `FirstOrderInput` + `computeNewCustomerMetrics` (additive, default = unchanged behavior). |
| `src/components/Dashboard.tsx` | Thread `source` onto `firstOrderRows`; build `channelTruth` memo; pass to hero + store modal; supply per-platform mapping-aware spend. |
| `src/components/home/CommandCenterHero.tsx` | Render `<ChannelTruthPanel>` under the NC tile (Feature 1+2+4 surface). |
| `src/lib/home/storeDetail.ts` | Add per-channel NC block to `StoreDetailData` (store-scoped). |
| `src/components/home/StoreDetailModal.tsx` | Render per-channel block in the modal. |
| `src/components/PnLBreakdown.tsx` | Add an expandable "רווח לפי ערוץ" (per-channel net) sub-section (Feature 2 surface) under the ad-spend line. |
| `src/components/CampaignDrawer.tsx` | Already per-campaign; add a roll-up note pointing to the new channel overcount (no logic change — see Feature 4 Task notes). |
| `src/lib/aiReport.ts` | Replace the prose "Meta overcounts" disclaimer with the QUANTIFIED per-channel overcount line (Feature 4). |
| `supabase/migrations/20260604130000_cohort_acquiring_channel.sql` | (Feature 3, DEFERRED) nullable `acquiring_channel` column on `customer_cohort_monthly`. |
| `docs/ROAS-Dashboard-User-Manual.md` | UX docs for the new per-channel panel (UI gate). |
| `docs/ARCHITECTURE.md` | Architecture note for `channelTruth.ts` + the deferred cohort column (lib/migration gate). |

---

## Feature: Per-channel approval mockup (UI gate — do FIRST)

> Impact: enabling (operator preference, global CLAUDE.md). Effort: S. CAPI-safe: yes (static HTML). Dependencies: none.

### Task 0 — Static mockup of the per-channel truth panel, delivered as an open-link

Per the global CLAUDE.md rule, any non-trivial UI element starts with a browser mockup approved by the operator BEFORE code. This single panel is the shared surface for Features 1, 2, and 4, so one mockup covers all three.

- [ ] Create `docs/superpowers/mockups/2026-06-04-channel-truth/channel-truth.html` — a self-contained static HTML page (inline `<style>`, no build step) showing the per-channel panel in BOTH light and dark (side-by-side `<section>`s with `data-theme` swatches). Columns per row: PlatformBadge (Meta blue / Google amber / TikTok pink, mirroring `--chart-meta/google/tiktok`), NC-ROAS, nCAC, Net (after COGS+fees), Overcount %. Include: a healthy Meta row (NC-ROAS 2.4x, net positive, overcount +38%), a bleeding TikTok row (NC-ROAS 0.6x, net negative red, overcount +120%), and a Google row with low confidence (badge "ביטחון נמוך"). Hebrew RTL (`dir="rtl"`). Use the real token hex values from `src/app/globals.css` (read them, do not invent) so the operator sees true colors. Numbers right-aligned tabular-nums, never clipped.
- [ ] Verify it renders: `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-channel-truth/channel-truth.html`
- [ ] Deliver to the operator as the literal command above (an open-link, NOT a screenshot) and request approval / iterate until approved.
- [ ] Commit: `git add docs/superpowers/mockups/2026-06-04-channel-truth && git commit -m "docs(ws2): per-channel truth panel approval mockup (light+dark, RTL)"`

> GATE: do not start Task 2 (the panel component) until the operator approves this mockup. Compute-only tasks (1.1–1.3, 2.1, 4.1) may proceed in parallel — they touch no UI.

---

## Feature: NC-ROAS / nCAC / payback broken down BY CHANNEL (gap `channel-nc-roas-split`)

> Impact: high. Effort: M. CAPI-safe: yes (reads existing deterministic `source` label only). Dependencies: Task 0 approval for the UI tasks (2.x); compute tasks (1.1–1.3) independent.

`computeNewCustomerMetrics` (`src/lib/home/newCustomerMetrics.ts:61-96`) currently scopes ONLY by `storeName`. The acquiring channel already lives on every order as `OrderAttributionRow.source` (`src/lib/ordersAttribution.ts:101-111`). We add a `source` to `FirstOrderInput`, an optional channel filter, and a `splitNewCustomerByChannel` adapter that runs `computeNewCustomerMetrics` once per paid channel with that channel's mapping-aware spend.

### Task 1.1 — Add `source` to `FirstOrderInput` + optional channel filter to `computeNewCustomerMetrics`

- [ ] Write the failing test. Append to `src/lib/home/__tests__/newCustomerMetrics.test.ts`:

```ts
describe('computeNewCustomerMetrics — acquiring-channel filter', () => {
  const mk = (over: Partial<FirstOrderInput>): FirstOrderInput => ({
    storeName: 'uzoshop', totalCad: 0, isFirstOrder: null, source: '', ...over,
  });

  it('channel filter scopes new-customer revenue/orders to one acquiring source', () => {
    const rows: FirstOrderInput[] = [
      mk({ totalCad: 100, isFirstOrder: true, source: 'meta-paid' }),
      mk({ totalCad: 40,  isFirstOrder: true, source: 'meta-paid' }),
      mk({ totalCad: 300, isFirstOrder: true, source: 'tiktok-paid' }),
      mk({ totalCad: 200, isFirstOrder: false, source: 'meta-paid' }), // returning
    ];
    const meta = computeNewCustomerMetrics(rows, 70, undefined, 1, 'meta-paid');
    expect(meta.ncRevenue).toBe(140);   // 100 + 40
    expect(meta.ncOrders).toBe(2);
    expect(meta.ncRoas).toBeCloseTo(2.0, 5); // 140 / 70
    expect(meta.nCac).toBeCloseTo(35, 5);    // 70 / 2
  });

  it('store + channel filters compose (both must match)', () => {
    const rows: FirstOrderInput[] = [
      mk({ storeName: 'uzoshop', totalCad: 100, isFirstOrder: true, source: 'meta-paid' }),
      mk({ storeName: 'zolplus', totalCad: 999, isFirstOrder: true, source: 'meta-paid' }),
    ];
    const m = computeNewCustomerMetrics(rows, 50, 'uzoshop', 1, 'meta-paid');
    expect(m.ncRevenue).toBe(100);
    expect(m.ncOrders).toBe(1);
  });

  it('omitting the channel filter is unchanged (back-compat)', () => {
    const rows: FirstOrderInput[] = [
      mk({ totalCad: 100, isFirstOrder: true, source: 'meta-paid' }),
      mk({ totalCad: 50,  isFirstOrder: true, source: 'tiktok-paid' }),
    ];
    const m = computeNewCustomerMetrics(rows, 100); // no source arg
    expect(m.ncRevenue).toBe(150);
    expect(m.ncOrders).toBe(2);
  });
});
```

- [ ] Run it (expect FAIL — `source` not on `FirstOrderInput`, 5th arg ignored): `npm run test -- src/lib/home/__tests__/newCustomerMetrics.test.ts`
- [ ] Minimal impl in `src/lib/home/newCustomerMetrics.ts`. Add to the `FirstOrderInput` interface (after the `isFirstOrder` field, ~line 27):

```ts
  /** Acquiring-channel label from orders_attribution.source (e.g. 'meta-paid').
   *  Optional for back-compat — callers that don't split by channel can omit
   *  it (defaults to '' = unknown). Used by the optional `source` scope filter
   *  on computeNewCustomerMetrics; never folded into any total when filtering. */
  source?: string;
```

Then extend the signature + the filter (the scoped-rows line, ~line 67):

```ts
export function computeNewCustomerMetrics(
  rows: FirstOrderInput[],
  merSpend: number | null,
  storeName?: string,
  netAdjust: number = 1,
  /** Optional acquiring-channel scope (orders_attribution.source). When set,
   *  only rows whose `source` matches are counted — composes with storeName.
   *  Mapping-aware by construction: the caller MUST pass the matching channel's
   *  mapping-aware spend as `merSpend` (never a blended/raw total). */
  source?: string,
): NewCustomerMetrics {
  const scoped = rows.filter(
    (r) =>
      (storeName ? r.storeName === storeName : true) &&
      (source ? (r.source ?? '') === source : true),
  );
  // ...rest unchanged (the accumulator loop + ratios below stay byte-identical)
```

- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/newCustomerMetrics.test.ts`
- [ ] Commit: `git add src/lib/home/newCustomerMetrics.ts src/lib/home/__tests__/newCustomerMetrics.test.ts && git commit -m "feat(ws2): optional acquiring-channel filter on computeNewCustomerMetrics"`

### Task 1.2 — `channelTruth.ts`: source→channel mapping + `splitNewCustomerByChannel`

- [ ] Write the failing test. Create `src/lib/home/__tests__/channelTruth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  sourceToPaidChannel,
  splitNewCustomerByChannel,
  PAID_CHANNELS,
  type ChannelNewCustomer,
} from '@/lib/home/channelTruth';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

const fo = (over: Partial<FirstOrderInput>): FirstOrderInput => ({
  storeName: 'uzoshop', totalCad: 0, isFirstOrder: null, source: '', ...over,
});

describe('sourceToPaidChannel', () => {
  it('maps the three paid acquiring sources to channel keys', () => {
    expect(sourceToPaidChannel('meta-paid')).toBe('meta');
    expect(sourceToPaidChannel('google-paid')).toBe('google');
    expect(sourceToPaidChannel('tiktok-paid')).toBe('tiktok');
  });
  it('returns null for organic / email / direct / unknown (not a paid channel)', () => {
    for (const s of ['meta-organic', 'google-organic', 'email', 'direct', 'other-paid', '']) {
      expect(sourceToPaidChannel(s)).toBeNull();
    }
  });
});

describe('splitNewCustomerByChannel', () => {
  const rows: FirstOrderInput[] = [
    fo({ totalCad: 100, isFirstOrder: true,  source: 'meta-paid' }),
    fo({ totalCad: 40,  isFirstOrder: true,  source: 'meta-paid' }),
    fo({ totalCad: 300, isFirstOrder: true,  source: 'tiktok-paid' }),
    fo({ totalCad: 200, isFirstOrder: false, source: 'google-paid' }), // returning
  ];
  const spendByChannel = { meta: 70, google: 50, tiktok: 600 };

  it('returns one entry per paid channel, each with its own mapping-aware spend', () => {
    const out = splitNewCustomerByChannel(rows, spendByChannel);
    expect(out.map((c) => c.channel)).toEqual(PAID_CHANNELS); // meta, google, tiktok
    const meta = out.find((c) => c.channel === 'meta')!;
    expect(meta.metrics.ncRevenue).toBe(140);
    expect(meta.metrics.ncRoas).toBeCloseTo(2.0, 5); // 140 / 70
    const tt = out.find((c) => c.channel === 'tiktok')!;
    expect(tt.metrics.ncRevenue).toBe(300);
    expect(tt.metrics.ncRoas).toBeCloseTo(0.5, 5); // 300 / 600 — bleeding
  });

  it('a channel with spend but zero new orders → nCac null, ncRoas null', () => {
    const out = splitNewCustomerByChannel(rows, spendByChannel);
    const g = out.find((c) => c.channel === 'google')!;
    expect(g.metrics.ncOrders).toBe(0); // only a returning google row
    expect(g.metrics.nCac).toBeNull();
    expect(g.metrics.ncRoas).toBeNull();
  });

  it('storeName scope composes through to each channel', () => {
    const scoped: FirstOrderInput[] = [
      fo({ storeName: 'uzoshop', totalCad: 100, isFirstOrder: true, source: 'meta-paid' }),
      fo({ storeName: 'zolplus', totalCad: 999, isFirstOrder: true, source: 'meta-paid' }),
    ];
    const out = splitNewCustomerByChannel(scoped, { meta: 50, google: 0, tiktok: 0 }, 'uzoshop');
    expect(out.find((c) => c.channel === 'meta')!.metrics.ncRevenue).toBe(100);
  });
});
```

- [ ] Run it (expect FAIL — module missing): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Minimal impl. Create `src/lib/home/channelTruth.ts`:

```ts
/**
 * Channel-level truth (WS2) — the per-acquiring-channel axis.
 *
 * Splits the dashboard's existing truth signals — NC-ROAS/nCAC, net profit,
 * platform-claim-vs-click-ID overcount — by acquiring channel (Meta / Google /
 * TikTok). ONE source of truth for the source→channel key mapping so every
 * surface (hero, store modal, P&L, AI report) agrees.
 *
 * MAPPING-AWARE by construction: new-customer revenue/orders come from
 * OrderAttributionRow.source (the deterministic click-ID acquiring label);
 * per-channel spend is ALWAYS the mapping-aware campaignRows[].spend the caller
 * passes in (the same platformAccum the hero/store CPM rows consume), NEVER the
 * raw account totals on data_daily (fbSpend/gaSpend/ttSpend).
 *
 * CAPI-safe: pure read of existing columns; never emits a pixel/CAPI event.
 */
import {
  computeNewCustomerMetrics,
  type FirstOrderInput,
  type NewCustomerMetrics,
} from '@/lib/home/newCustomerMetrics';

/** Canonical paid-channel keys, stable order (Meta → Google → TikTok), matching
 *  PerStoreRow + storeDetail.platforms. */
export const PAID_CHANNELS = ['meta', 'google', 'tiktok'] as const;
export type PaidChannel = (typeof PAID_CHANNELS)[number];

/** Per-channel mapping-aware spend (CAD). Caller-supplied — never recomputed. */
export type SpendByChannel = Record<PaidChannel, number>;

export interface ChannelNewCustomer {
  channel: PaidChannel;
  /** This channel's mapping-aware spend used as the nCAC/NC-ROAS denominator. */
  spend: number;
  metrics: NewCustomerMetrics;
}

/**
 * Map an orders_attribution.source label to a paid acquiring channel, or null
 * when the source is organic/email/direct/unknown (not a paid acquisition we
 * can charge spend against). Only the '*-paid' deterministic labels qualify.
 */
export function sourceToPaidChannel(source: string | null | undefined): PaidChannel | null {
  switch ((source ?? '').trim()) {
    case 'meta-paid':   return 'meta';
    case 'google-paid': return 'google';
    case 'tiktok-paid': return 'tiktok';
    default:            return null;
  }
}

/** orders_attribution.source value for each paid channel (inverse of above). */
const CHANNEL_SOURCE: Record<PaidChannel, string> = {
  meta:   'meta-paid',
  google: 'google-paid',
  tiktok: 'tiktok-paid',
};

/**
 * Split new-customer metrics by acquiring channel. Runs the pure NC adapter
 * once per channel, each with that channel's own mapping-aware spend. Returns
 * exactly PAID_CHANNELS entries in stable order (a channel with no rows yields a
 * zeroed NewCustomerMetrics — never dropped, so the UI shows all three).
 *
 * @param rows           first-order rows (carry source + storeName + totalCad)
 * @param spendByChannel mapping-aware spend per channel (campaignRows-derived)
 * @param storeName      optional store scope (composes with the channel filter)
 * @param netAdjust      optional gross→net factor (same as the blended tile)
 */
export function splitNewCustomerByChannel(
  rows: FirstOrderInput[],
  spendByChannel: SpendByChannel,
  storeName?: string,
  netAdjust: number = 1,
): ChannelNewCustomer[] {
  return PAID_CHANNELS.map((channel) => {
    const spend = spendByChannel[channel] ?? 0;
    const metrics = computeNewCustomerMetrics(
      rows,
      spend,
      storeName,
      netAdjust,
      CHANNEL_SOURCE[channel],
    );
    return { channel, spend, metrics };
  });
}
```

- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Commit: `git add src/lib/home/channelTruth.ts src/lib/home/__tests__/channelTruth.test.ts && git commit -m "feat(ws2): channelTruth source→channel map + splitNewCustomerByChannel"`

### Task 1.3 — `spendByChannel` mapping-aware accumulator (campaignRows → per channel)

The denominator for per-channel NC-ROAS/nCAC must be the SAME mapping-aware per-platform spend the store modal already builds in `storeDetail.ts:193-218` (`platformAccum`). Extract a reusable helper so the hero + store modal compute it identically.

- [ ] Write the failing test. Append to `src/lib/home/__tests__/channelTruth.test.ts`:

```ts
import { spendByChannelFromCampaigns } from '@/lib/home/channelTruth';
import type { CampaignRow } from '@/lib/campaigns';

const cr = (over: Partial<CampaignRow>): CampaignRow =>
  ({
    date: '2026-06-01', storeId: 's1', storeName: 'uzoshop',
    platform: 'Meta', campaignId: 'c1', campaignName: 'C1', adSetId: '', adSetName: '',
    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
    campaignBudgetCad: null, adSetBudgetCad: null, budgetType: '',
    effectiveStatus: null, regConfiguredStatus: null, regEffectiveStatus: null,
    regDeliveryStatus: null, regFirstSeenAt: null, regStatusChangedAt: null,
    regLastStatusSuccessAt: null, ...over,
  }) as CampaignRow;

describe('spendByChannelFromCampaigns', () => {
  it('accumulates mapping-aware per-platform spend within the range', () => {
    const rows: CampaignRow[] = [
      cr({ platform: 'Meta',   spend: 100 }),
      cr({ platform: 'meta',   spend: 50 }),   // alias casing
      cr({ platform: 'Google', spend: 30 }),
      cr({ platform: 'TikTok', spend: 600 }),
      cr({ platform: 'Meta',   spend: 999, date: '2026-07-01' }), // out of range
    ];
    const out = spendByChannelFromCampaigns(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(out).toEqual({ meta: 150, google: 30, tiktok: 600 });
  });

  it('scopes by storeName when provided', () => {
    const rows: CampaignRow[] = [
      cr({ platform: 'Meta', spend: 100, storeName: 'uzoshop' }),
      cr({ platform: 'Meta', spend: 999, storeName: 'zolplus' }),
    ];
    const out = spendByChannelFromCampaigns(rows, { from: '2026-06-01', to: '2026-06-30' }, 'uzoshop');
    expect(out.meta).toBe(100);
  });

  it('undefined campaignRows → all zeros (no throw)', () => {
    expect(spendByChannelFromCampaigns(undefined, { from: '2026-06-01', to: '2026-06-30' }))
      .toEqual({ meta: 0, google: 0, tiktok: 0 });
  });
});
```

- [ ] Run it (expect FAIL): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Minimal impl. Append to `src/lib/home/channelTruth.ts` (import `normalizePlatform` + `CampaignRow` at top):

```ts
import { normalizePlatform } from '@/components/ui/PlatformBadge';
import type { CampaignRow } from '@/lib/campaigns';

/**
 * Accumulate mapping-aware per-channel spend from campaign rows for a range —
 * the SAME logic as storeDetail.ts's platformAccum, extracted so the hero +
 * store modal compute the NC-ROAS denominator identically. NEVER reads
 * data_daily's raw account fbSpend/gaSpend/ttSpend.
 */
export function spendByChannelFromCampaigns(
  campaignRows: CampaignRow[] | undefined,
  range: { from: string; to: string },
  storeName?: string,
): SpendByChannel {
  const out: SpendByChannel = { meta: 0, google: 0, tiktok: 0 };
  if (!campaignRows) return out;
  for (const r of campaignRows) {
    if (r.date < range.from || r.date > range.to) continue;
    if (storeName && r.storeName !== storeName) continue;
    const plat = normalizePlatform(r.platform);
    if (plat === 'meta' || plat === 'google' || plat === 'tiktok') {
      out[plat] += r.spend;
    }
  }
  return out;
}
```

- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Commit: `git add src/lib/home/channelTruth.ts src/lib/home/__tests__/channelTruth.test.ts && git commit -m "feat(ws2): mapping-aware spendByChannelFromCampaigns accumulator"`

### Task 2 — `<ChannelTruthPanel>` presentational component (Feature 1+2+4 shared surface)

> GATE: requires Task 0 operator approval.

- [ ] Write the failing DOM test. Create `src/components/home/__tests__/ChannelTruthPanel.dom.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChannelTruthPanel } from '@/components/home/ChannelTruthPanel';
import type { ChannelTruthRow } from '@/components/home/ChannelTruthPanel';

const rows: ChannelTruthRow[] = [
  { channel: 'meta',   spend: 70,  ncRoas: 2.4, nCac: 35, ncOrders: 2, netProfit: 120, overcountPct: 0.38, confidence: 'ok' },
  { channel: 'tiktok', spend: 600, ncRoas: 0.6, nCac: 300, ncOrders: 2, netProfit: -180, overcountPct: 1.2, confidence: 'ok' },
  { channel: 'google', spend: 50,  ncRoas: null, nCac: null, ncOrders: 0, netProfit: 0, overcountPct: null, confidence: 'low' },
];

describe('ChannelTruthPanel', () => {
  it('renders one row per paid channel with a PlatformBadge', () => {
    render(<ChannelTruthPanel rows={rows} />);
    const panel = screen.getByTestId('channel-truth-panel');
    expect(within(panel).getByText('Meta')).toBeInTheDocument();
    expect(within(panel).getByText('TikTok')).toBeInTheDocument();
    expect(within(panel).getByText('Google')).toBeInTheDocument();
  });

  it('renders the dir="rtl" container (Hebrew RTL)', () => {
    render(<ChannelTruthPanel rows={rows} />);
    expect(screen.getByTestId('channel-truth-panel').getAttribute('dir')).toBe('rtl');
  });

  it('shows "—" for null NC-ROAS / nCAC / overcount (Google, 0 new orders)', () => {
    render(<ChannelTruthPanel rows={rows} />);
    const g = screen.getByTestId('channel-truth-row-google');
    expect(within(g).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the low-confidence badge for a low-confidence channel', () => {
    render(<ChannelTruthPanel rows={rows} />);
    const g = screen.getByTestId('channel-truth-row-google');
    expect(within(g).getByText('ביטחון נמוך')).toBeInTheDocument();
  });

  it('uses token classes for negative net (no raw hex)', () => {
    const { container } = render(<ChannelTruthPanel rows={rows} />);
    // negative net cell carries the cost token, not a hex literal
    expect(container.querySelector('.text-status-dangerFg, .text-status-down')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('empty rows → renders nothing (null guard)', () => {
    const { container } = render(<ChannelTruthPanel rows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] Run it (expect FAIL — component missing): `npm run test:components -- src/components/home/__tests__/ChannelTruthPanel.dom.test.tsx`
- [ ] Minimal impl. Create `src/components/home/ChannelTruthPanel.tsx`. Mirror the `StoreDetailModal.tsx:402-435` per-platform card grid + `Money`/`PlatformBadge` usage. Token-driven (`text-ink`, `text-ink-secondary`, `text-status-dangerFg` for negative net, `bg-status-warningBg`/`text-status-warningFg` for the low-confidence badge), light+dark via tokens, RTL via `dir="rtl"`, numbers through `<Money>` (tabular-nums, compactAbove, never clipped) and `bdi dir="ltr"` for ratios. Resolve the exact status tokens used for the negative-net cell by reading `StoreDetailModal.tsx` / `CommandCenterHero.tsx` for the canonical cost token (the test allows either `text-status-dangerFg` or `text-status-down`; use whichever the codebase actually defines). Shape:

```tsx
'use client';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { Badge } from '@/components/ui/Badge';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import type { PaidChannel } from '@/lib/home/channelTruth';
import type { NcConfidence } from '@/lib/home/newCustomerMetrics';

export interface ChannelTruthRow {
  channel: PaidChannel;
  spend: number;
  ncRoas: number | null;
  nCac: number | null;
  ncOrders: number;
  /** Net profit after COGS+fees attributable to this channel (Feature 2). */
  netProfit: number;
  /** (platformClaim − verified) / platformClaim; null when no claim. (Feature 4) */
  overcountPct: number | null;
  confidence: NcConfidence;
}

export interface ChannelTruthPanelProps {
  rows: ChannelTruthRow[];
  className?: string;
}

export function ChannelTruthPanel({ rows, className }: ChannelTruthPanelProps) {
  if (!rows.length) return null;
  return (
    <div dir="rtl" data-testid="channel-truth-panel" className={className}>
      {/* per-channel cards/grid — PlatformBadge + NC-ROAS / nCAC / net / overcount,
          each metric a <Money> or bdi-wrapped ratio; negative net → cost token;
          confidence === 'low' → <Badge tone="warning">ביטחון נמוך</Badge>;
          confidence === 'suppressed' → hide ratios, show "לא מספיק דאטה לסיווג" */}
      {rows.map((r) => (
        <Card key={r.channel} data-testid={`channel-truth-row-${r.channel}`} /* ...token classes */>
          {/* implement per the approved mockup */}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] Run it (expect PASS): `npm run test:components -- src/components/home/__tests__/ChannelTruthPanel.dom.test.tsx`
- [ ] Run the readability/lint guards on the new component (must pass, not bypass): `npm run lint -- src/components/home/ChannelTruthPanel.tsx`
- [ ] Commit: `git add src/components/home/ChannelTruthPanel.tsx src/components/home/__tests__/ChannelTruthPanel.dom.test.tsx && git commit -m "feat(ws2): ChannelTruthPanel (per-channel NC-ROAS/net/overcount, token-driven RTL AA)"`

### Task 3 — Wire channel NC-ROAS into Dashboard hero (thread `source` + spendByChannel)

- [ ] Write the failing test. Create `src/lib/home/__tests__/channelTruthWiring.test.ts` (a pure adapter test so we don't have to mount the whole Dashboard — extract the hero channel-rows builder into `channelTruth.ts` as `toChannelTruthRows`):

```ts
import { describe, it, expect } from 'vitest';
import { toChannelTruthRows } from '@/lib/home/channelTruth';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

const fo = (o: Partial<FirstOrderInput>): FirstOrderInput =>
  ({ storeName: 'uzoshop', totalCad: 0, isFirstOrder: null, source: '', ...o });

describe('toChannelTruthRows (hero builder)', () => {
  it('builds one ChannelTruthRow per channel from rows + spend + claim/verified', () => {
    const rows: FirstOrderInput[] = [
      fo({ totalCad: 100, isFirstOrder: true, source: 'meta-paid' }),
      fo({ totalCad: 300, isFirstOrder: true, source: 'tiktok-paid' }),
    ];
    const out = toChannelTruthRows({
      firstOrderRows: rows,
      spendByChannel: { meta: 50, google: 0, tiktok: 600 },
      netByChannel:   { meta: 60, google: 0, tiktok: -180 },
      overcountByChannel: { meta: 0.4, google: null, tiktok: 1.2 },
      netAdjust: 1,
    });
    const meta = out.find((r) => r.channel === 'meta')!;
    expect(meta.ncRoas).toBeCloseTo(2.0, 5); // 100 / 50
    expect(meta.netProfit).toBe(60);
    expect(meta.overcountPct).toBe(0.4);
    const tt = out.find((r) => r.channel === 'tiktok')!;
    expect(tt.ncRoas).toBeCloseTo(0.5, 5);
    expect(tt.netProfit).toBe(-180);
  });
});
```

- [ ] Run it (expect FAIL): `npm run test -- src/lib/home/__tests__/channelTruthWiring.test.ts`
- [ ] Minimal impl. Add `toChannelTruthRows` to `channelTruth.ts` (combines `splitNewCustomerByChannel` + the netByChannel/overcountByChannel maps from Features 2 & 4 into `ChannelTruthRow[]`). Signature accepts the three per-channel maps and the firstOrderRows; returns `ChannelTruthRow[]` in `PAID_CHANNELS` order. (Until Features 2 & 4 land, the netByChannel/overcountByChannel maps may be all-zero/all-null — the row still renders the NC columns; wire the real maps in Tasks 2.1/4.1's integration step.)
- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/channelTruthWiring.test.ts`
- [ ] Now wire into `src/components/Dashboard.tsx`:
  - Extend `firstOrderRows` memo (`Dashboard.tsx:430-437`) to also map `source: r.source` from each `OrderAttributionRow`.
  - Add a `channelTruthRows` memo computing `spendByChannelFromCampaigns(campaignsData?.rows, filters.range, scope)` + `toChannelTruthRows(...)` with the hero's existing `ncNetAdj` factor (`Dashboard.tsx:977`). Scope = `filters.store === 'All' ? undefined : filters.store`.
  - Pass `channelTruthRows` to `<CommandCenterHero>` (new prop) which renders `<ChannelTruthPanel rows={channelTruthRows} />` directly under the existing NC tile (`CommandCenterHero.tsx:840-919`).
- [ ] Add a DOM test to `src/components/home/__tests__/CommandCenterHero.dom.test.tsx` asserting the panel renders when `channelTruthRows` is passed and is absent when omitted (back-compat).
- [ ] Run both suites: `npm run test:components -- src/components/home/__tests__/CommandCenterHero.dom.test.tsx`
- [ ] Commit: `git add src/lib/home/channelTruth.ts src/lib/home/__tests__/channelTruthWiring.test.ts src/components/Dashboard.tsx src/components/home/CommandCenterHero.tsx src/components/home/__tests__/CommandCenterHero.dom.test.tsx && git commit -m "feat(ws2): wire per-channel NC-ROAS panel into Dashboard hero"`

### Task 4 — Per-channel NC block in the store-detail modal (store-scoped)

- [ ] Write the failing test. Append to `src/lib/home/__tests__/storeDetail.test.ts` a case asserting `toStoreDetail(...)` returns a `channelTruth` array (one entry per paid channel) when `firstOrderRows` carry `source` and `campaignRows` carry per-platform spend, scoped to the store. Mirror the existing `newCustomer` assertions in that file.
- [ ] Run it (expect FAIL): `npm run test -- src/lib/home/__tests__/storeDetail.test.ts`
- [ ] Minimal impl in `src/lib/home/storeDetail.ts`: add `channelTruth: ChannelNewCustomer[]` to `StoreDetailData`; compute via `splitNewCustomerByChannel(firstOrderRows, spendByChannelFromCampaigns(campaignRows, range, storeName), storeName, ncNetAdj)` right after the existing `newCustomer` line (`storeDetail.ts:259`). Reuse the `platformAccum` spend already built in-file (or call the new helper — pick the DRY path; the helper is preferred).
- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/storeDetail.test.ts`
- [ ] Render it in `src/components/home/StoreDetailModal.tsx` (a `<ChannelTruthPanel>`-style block, or reuse the component with store-scoped rows). DOM-test the render.
- [ ] Commit: `git add src/lib/home/storeDetail.ts src/components/home/StoreDetailModal.tsx src/lib/home/__tests__/storeDetail.test.ts && git commit -m "feat(ws2): per-channel NC-ROAS block in store-detail modal"`

---

## Feature: Per-channel net profit (gap `per-channel-net-profit`)

> Impact: high. Effort: M. CAPI-safe: yes. Dependencies: Task 1.3 (`spendByChannelFromCampaigns`); shares the `<ChannelTruthPanel>` net column (Task 2). DEPENDS-ON-OTHER-WORKSTREAM: none — the P&L cascade math is self-contained in `analytics.ts`.

The P&L cascade (`analytics.ts:163-282`: cogs, transactionFees, fixedCosts, salaries, trueNetProfit) is blended/per-store only. The only per-platform fields are spend/ROAS. We add a per-channel net cascade. Revenue is allocated to a channel by the channel's mapping-aware platform-attributed conversion value (`campaignRows[].conversionValue` per platform) — the same proportional basis the store modal already uses for per-platform ROAS. COGS + transaction fees are applied at the same rates as the blended cascade; fixed costs + salaries are NOT split (they're not channel-attributable — documented). Net per channel = channelRevenue − channelSpend − channelCOGS − channelFees.

### Task 2.1 — `netByChannel` cascade in `channelTruth.ts`

- [ ] Write the failing test. Append to `src/lib/home/__tests__/channelTruth.test.ts`:

```ts
import { netByChannelFromCampaigns } from '@/lib/home/channelTruth';

describe('netByChannelFromCampaigns', () => {
  it('net = channel revenue − spend − COGS − fees, per channel', () => {
    const rows = [
      cr({ platform: 'Meta',   spend: 100, conversionValue: 1000 }),
      cr({ platform: 'TikTok', spend: 500, conversionValue: 400 }),
    ];
    // cogsRate 0.25, feesRate 0.065 (project defaults)
    const out = netByChannelFromCampaigns(rows, { from: '2026-06-01', to: '2026-06-30' }, {
      cogsRate: 0.25, feesRate: 0.065,
    });
    // Meta: 1000 − 100 − (1000*0.25) − (1000*0.065) = 1000 − 100 − 250 − 65 = 585
    expect(out.meta).toBeCloseTo(585, 5);
    // TikTok: 400 − 500 − 100 − 26 = −226  (bleeding channel, negative)
    expect(out.tiktok).toBeCloseTo(-226, 5);
    expect(out.google).toBe(0); // no rows
  });

  it('scopes by storeName', () => {
    const rows = [
      cr({ platform: 'Meta', spend: 10, conversionValue: 100, storeName: 'uzoshop' }),
      cr({ platform: 'Meta', spend: 10, conversionValue: 999, storeName: 'zolplus' }),
    ];
    const out = netByChannelFromCampaigns(rows, { from: '2026-06-01', to: '2026-06-30' },
      { cogsRate: 0.25, feesRate: 0.065 }, 'uzoshop');
    // 100 − 10 − 25 − 6.5 = 58.5
    expect(out.meta).toBeCloseTo(58.5, 5);
  });
});
```

- [ ] Run it (expect FAIL): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Minimal impl. Append `netByChannelFromCampaigns` to `channelTruth.ts`:

```ts
export interface ChannelNetRates {
  /** COGS fraction (0..1) — same effective rate as the blended P&L. */
  cogsRate: number;
  /** Transaction-fees fraction (0..1) — same as analytics.ts. */
  feesRate: number;
}

/**
 * Per-channel NET profit after COGS + transaction fees. Revenue per channel =
 * Σ mapping-aware campaignRows[].conversionValue for that platform (the SAME
 * platform-attributed basis the store-modal per-platform ROAS uses). Fixed
 * costs + salaries are NOT split — they're not channel-attributable, so this is
 * a CONTRIBUTION net (revenue − spend − COGS − fees), not the full
 * trueNetProfit. Documented in the User Manual + the panel tooltip.
 *
 * net[ch] = rev[ch] − spend[ch] − rev[ch]*cogsRate − rev[ch]*feesRate
 */
export function netByChannelFromCampaigns(
  campaignRows: CampaignRow[] | undefined,
  range: { from: string; to: string },
  rates: ChannelNetRates,
  storeName?: string,
): SpendByChannel {
  const spend: SpendByChannel = { meta: 0, google: 0, tiktok: 0 };
  const rev: SpendByChannel = { meta: 0, google: 0, tiktok: 0 };
  if (campaignRows) {
    for (const r of campaignRows) {
      if (r.date < range.from || r.date > range.to) continue;
      if (storeName && r.storeName !== storeName) continue;
      const plat = normalizePlatform(r.platform);
      if (plat === 'meta' || plat === 'google' || plat === 'tiktok') {
        spend[plat] += r.spend;
        rev[plat] += r.conversionValue;
      }
    }
  }
  const keep = 1 - rates.cogsRate - rates.feesRate;
  const out: SpendByChannel = { meta: 0, google: 0, tiktok: 0 };
  for (const ch of PAID_CHANNELS) {
    out[ch] = rev[ch] * keep - spend[ch];
  }
  return out;
}
```

(Note the `rev*keep − spend` form is algebraically identical to `rev − spend − rev*cogs − rev*fees`; both produce 585 / −226 for the test inputs.)

- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Commit: `git add src/lib/home/channelTruth.ts src/lib/home/__tests__/channelTruth.test.ts && git commit -m "feat(ws2): per-channel net-profit cascade (rev − spend − COGS − fees)"`

### Task 2.2 — Surface per-channel net in the hero panel + P&L breakdown

- [ ] In `Dashboard.tsx`, compute `netByChannel` (using the effective COGS rate the P&L already resolves for the scope + `TRANSACTION_FEES_RATE`/per-store fees) and feed it into `toChannelTruthRows(...)` so the panel's Net column lights up (the column already exists from Task 2; this populates it with real data).
- [ ] Add an expandable "רווח לפי ערוץ" sub-row to `src/components/PnLBreakdown.tsx` directly under the ad-spend line (`PnLBreakdown.tsx:264-271`). Pass `current`'s revenue basis + the per-channel net map (threaded as a new optional prop `netByChannel?: Record<PaidChannel, number>`; default omit = unchanged P&L). Each channel renders as a `<PnLLine>`-style row (PlatformBadge + `<Money>` net, cost/positive tone token by sign). Add a `<HelpTooltip>` explaining this is contribution-net (fixed costs/salaries not split). Keep the existing combined "Meta + Google + TikTok · MER" line intact (it stays — no info loss).
- [ ] Write a DOM test in `src/components/__tests__/PnLBreakdownChannelNet.dom.test.tsx`: pass `netByChannel`, assert three labelled rows render with correct sign tone; assert when the prop is omitted the P&L is byte-identical to before (snapshot the line count).
- [ ] Run: `npm run test:components -- src/components/__tests__/PnLBreakdownChannelNet.dom.test.tsx`
- [ ] Run the lint guards on the touched component: `npm run lint -- src/components/PnLBreakdown.tsx`
- [ ] Commit: `git add src/components/PnLBreakdown.tsx src/components/Dashboard.tsx src/components/__tests__/PnLBreakdownChannelNet.dom.test.tsx && git commit -m "feat(ws2): per-channel net profit in hero panel + P&L breakdown sub-rows"`

---

## Feature: Per-channel overcount delta (gap `channel-overcount-delta`)

> Impact: high. Effort: M. CAPI-safe: yes (rolls up existing `analyzeAttribution` over click-IDs vs platform claim). Dependencies: Task 2 (`<ChannelTruthPanel>` overcount column); reuses `analyzeAttribution`/`computeCoverage` from `attributionAnalysis.ts` unchanged.

`analyzeAttribution` (`attributionAnalysis.ts:334-635`) gives per-campaign `deterministicRevenue` (click-ID-verified) vs `metaClaim` (platform conversion_value) with `coverage`. This exists ONLY per single campaign in the drawer. We add a cross-campaign roll-up per channel: "Meta claims $X, click-ID-verified $Y, overcount +Z%". We do NOT touch `analyzeAttribution`; we call it (or its `computeCoverage` primitive) per campaign and aggregate.

### Task 4.1 — `overcountByChannel` roll-up in `channelTruth.ts`

- [ ] Write the failing test. Append to `src/lib/home/__tests__/channelTruth.test.ts`:

```ts
import { overcountByChannelFromCampaigns } from '@/lib/home/channelTruth';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const oar = (o: Partial<OrderAttributionRow>): OrderAttributionRow =>
  ({
    date: '2026-06-02', storeId: 's1', storeName: 'uzoshop', orderId: 'o1',
    totalCad: 0, source: 'meta-paid', utmSource: '', utmMedium: '', utmCampaign: '',
    utmContent: '', fbclidPresent: true, gclidPresent: false, referringSite: '',
    utmId: '', utmTerm: '', lineItems: [], customerId: null, orderCreatedAt: null,
    isFirstOrder: true, firstTouchSource: null, firstFbclidPresent: false,
    firstGclidPresent: false, firstTtclidPresent: false, firstUtmSource: null,
    firstUtmMedium: null, firstUtmCampaign: null, firstUtmContent: null,
    firstUtmId: null, firstUtmTerm: null, firstSeenAt: null, ...o,
  }) as OrderAttributionRow;

describe('overcountByChannelFromCampaigns', () => {
  it('rolls campaign claim vs click-ID-verified up to a per-channel overcount %', () => {
    // Meta campaign C1 claims 1000; two click-ID-matched orders total 600 → verified 600.
    const campaigns = [
      cr({ platform: 'Meta', campaignId: 'C1', campaignName: 'C1', conversionValue: 1000, spend: 100 }),
    ];
    const orders: OrderAttributionRow[] = [
      oar({ utmCampaign: 'C1', totalCad: 400 }),
      oar({ utmCampaign: 'C1', totalCad: 200 }),
    ];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    // claim 1000, verified 600 → overcount = (1000 − 600) / 1000 = 0.40
    expect(out.meta!.claim).toBeCloseTo(1000, 5);
    expect(out.meta!.verified).toBeCloseTo(600, 5);
    expect(out.meta!.overcountPct).toBeCloseTo(0.40, 5);
    expect(out.tiktok).toBeNull(); // no TikTok campaigns
  });

  it('verified ≥ claim (halo) → overcountPct clamps to 0 (not negative noise)', () => {
    const campaigns = [cr({ platform: 'Meta', campaignId: 'C2', campaignName: 'C2', conversionValue: 300 })];
    const orders = [oar({ utmCampaign: 'C2', totalCad: 500 })];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.meta!.overcountPct).toBe(0);
  });

  it('no claim on a channel → overcountPct null', () => {
    const campaigns = [cr({ platform: 'Google', campaignId: 'G1', campaignName: 'G1', conversionValue: 0 })];
    const out = overcountByChannelFromCampaigns(campaigns, [], '2026-06-01', '2026-06-30');
    expect(out.google!.overcountPct).toBeNull();
  });
});
```

- [ ] Run it (expect FAIL): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Minimal impl. Append `overcountByChannelFromCampaigns` to `channelTruth.ts` (import `analyzeAttribution` + `orderMatchesCampaign` from `@/lib/attributionAnalysis`, `OrderAttributionRow` from `@/lib/ordersAttribution`). For each in-range campaign, sum `conversionValue` into `claim[channel]` and run the SAME deterministic match (`analyzeAttribution(...).deterministicRevenue`, OR directly `orderMatchesCampaign` to avoid recomputing the full trust ladder — pick the lighter path; `analyzeAttribution` is heavier but is the documented single source of truth, so prefer summing its `deterministicRevenue`). Then per channel:

```ts
export interface ChannelOvercount {
  /** Σ platform conversion_value across the channel's campaigns. */
  claim: number;
  /** Σ click-ID-verified deterministicRevenue across the channel's campaigns. */
  verified: number;
  /** max(0, (claim − verified) / claim); null when claim ≤ 0. */
  overcountPct: number | null;
}
export type OvercountByChannel = Record<PaidChannel, ChannelOvercount | null>;

export function overcountByChannelFromCampaigns(
  campaignRows: CampaignRow[] | undefined,
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  storeName?: string,
): OvercountByChannel { /* ...accumulate per channel; overcountPct = claim>0 ? max(0,(claim−verified)/claim) : null */ }
```

Map `campaign.platform` → channel via `normalizePlatform`; the platform string passed to `analyzeAttribution` must be the capitalized form it expects (`'Meta'`/`'Google'`/`'TikTok'`) — use the original `r.platform` (already that casing in `campaigns_daily`), or normalize+re-capitalize. Return `null` for a channel with zero campaigns.

- [ ] Run it (expect PASS): `npm run test -- src/lib/home/__tests__/channelTruth.test.ts`
- [ ] Commit: `git add src/lib/home/channelTruth.ts src/lib/home/__tests__/channelTruth.test.ts && git commit -m "feat(ws2): per-channel claim-vs-verified overcount roll-up"`

### Task 4.2 — Surface per-channel overcount in the hero panel + AI report

- [ ] In `Dashboard.tsx`, compute `overcountByChannel` from `campaignsData?.rows` + `ordersData?.rows` for the range/scope and feed `overcountPct` into `toChannelTruthRows(...)` (populates the panel's Overcount column from Task 2).
- [ ] In `src/components/CampaignDrawer.tsx`, add a one-line note above the existing per-campaign `<AttributionAnalysisPanel>` that links the operator to the channel-level roll-up in the hero ("הפער ברמת הערוץ מוצג ב…") — NO logic change to the per-campaign analysis (it stays). Pure copy + an anchor/scroll. DOM-test the note renders.
- [ ] In `src/lib/aiReport.ts`, replace the qualitative "Meta לעיתים מייחס…" prose (`aiReport.ts:166-173`) with a QUANTIFIED per-channel line built from `overcountByChannelFromCampaigns(...)` for the report's range/store: e.g. `Meta: claim $X, click-ID-verified $Y → overcount +Z%`, one bullet per channel that has a claim; keep the iOS14/modeled explanation as a tail note. Write a unit test in `src/lib/__tests__/aiReportChannelOvercount.test.ts` asserting the quantified line appears with the right %.
- [ ] Run: `npm run test -- src/lib/__tests__/aiReportChannelOvercount.test.ts` and `npm run test:components -- src/components/CampaignDrawer`
- [ ] Commit: `git add src/lib/aiReport.ts src/components/CampaignDrawer.tsx src/components/Dashboard.tsx src/lib/__tests__/aiReportChannelOvercount.test.ts && git commit -m "feat(ws2): quantify per-channel overcount in hero panel + AI report (replaces prose)"`

---

## Feature: Per-channel CAC payback / months-to-recover (gap `channel-payback-curve`)

> Impact: LOW. Effort: L. CAPI-safe: yes. Dependencies: Feature 1 (channel nCAC). **DEFER until ~mid-2027.**

> WHY DEFERRED: `customer_cohort_monthly` keys on `(store_id, first_order_month, month_since)` with NO channel dimension (`supabase/migrations/20260603100000_customer_cohort_monthly.sql`), and reliable click-ID acquiring attribution only began ~May 2026. A per-channel payback curve needs ≥12 months of channel-attributed cohorts to be meaningful (the LTV maturity gate in `customerValue.ts` is `MATURE_MONTHS = 12`). Cohorts before ~May 2026 have no trustworthy acquiring channel, so any per-channel curve computed today would be ~0–1 mature data points — falsely precise. We lay the SCHEMA + a guarded stub now (so the May-2026+ cohorts start accumulating the channel dimension immediately), but do NOT build the UI curve until mid-2027 when the first channel-attributed cohorts mature.

### Task 3.1 — (DEFERRED-SCHEMA) Add nullable `acquiring_channel` column to `customer_cohort_monthly`

> This is the only part to ship NOW: start collecting the channel dimension so 2027's curve has data. The column is nullable (pre-existing cells stay NULL = "channel unknown"), additive, idempotent.

- [ ] Write the migration `supabase/migrations/20260604130000_cohort_acquiring_channel.sql`:

```sql
-- WS2 channel-payback (DEFERRED build, schema-now) — add a nullable acquiring
-- channel dimension to the per-cohort monthly aggregate so May-2026+ cohorts
-- start accumulating it immediately. NULL = channel unknown (every pre-existing
-- cell + every guest-free cohort whose first order predates reliable click-ID
-- acquiring attribution). Additive + idempotent. Does NOT change the PRIMARY KEY
-- yet (would require a full re-seed); the dimension is read best-effort until the
-- 2027 build re-keys + re-backfills. See plan 2026-06-04-improvement-ws2-channel-truth.md.

ALTER TABLE public.customer_cohort_monthly
  ADD COLUMN IF NOT EXISTS acquiring_channel TEXT;

COMMENT ON COLUMN public.customer_cohort_monthly.acquiring_channel IS
  'WS2 (deferred) — paid acquiring channel of the cohort''s first order (''meta''/''google''/''tiktok''), from orders_attribution.source. NULL when unknown (pre-May-2026 cohorts / organic / not-yet-backfilled). Read best-effort until the 2027 per-channel payback build re-keys + re-seeds.';

GRANT ALL ON public.customer_cohort_monthly TO anon, service_role;
```

- [ ] Apply to prod via the documented procedure (memory `reference_supabase_migration_procedure`):
  1. From repo root, temporarily hide the root `.env` (dotted keys break the CLI parser): `mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.hidden`
  2. Move the 2 duplicate-timestamp gap files out so `db push` doesn't fail on duplicate-key:
     `mkdir -p /tmp/miggap && mv /Users/dorperetz/script-roas/supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql /tmp/miggap/ && mv /Users/dorperetz/script-roas/supabase/migrations/20260530310000_agg_data_daily_for_date.sql /tmp/miggap/`
  3. `cd /Users/dorperetz/script-roas && supabase db push`
  4. Restore both gap files and the env: `mv /tmp/miggap/*.sql /Users/dorperetz/script-roas/supabase/migrations/ && mv /Users/dorperetz/script-roas/.env.hidden /Users/dorperetz/script-roas/.env`
- [ ] Re-backfill NOTE (do NOT run the full re-seed now — deferred): `scripts/backfillCohortMonthly.ts` + `src/inngest/functions/cronCohortRefresh.ts` (full-replace per store) will need to populate `acquiring_channel` by joining `orders_attribution.source` onto each cohort's FIRST order when the 2027 build lands. Record this as a TODO in `docs/ARCHITECTURE.md` (the lib/migration docs gate). Until then the column reads NULL and the deferred UI stays hidden.
- [ ] Commit: `git add supabase/migrations/20260604130000_cohort_acquiring_channel.sql && git commit -m "feat(ws2): nullable acquiring_channel on customer_cohort_monthly (deferred per-channel payback schema)"`

### Task 3.2 — (DEFERRED-BUILD) Per-channel payback curve — STUB ONLY, gated off

- [ ] Add a `computeChannelPayback` stub to `customerValue.ts` that accepts a `channel` param + per-channel `nCac` (from Feature 1) and the channel-keyed cohort rows, and returns `{ paybackMonths: null, deferred: true }` whenever the mature channel-attributed cohort count is < 1 (which is ALWAYS true until ~mid-2027). Write a test asserting it returns `deferred: true` for today's data.
- [ ] Run: `npm run test -- src/lib/home/__tests__/customerValue.test.ts`
- [ ] Do NOT render any UI for this yet. Leave a clearly-commented `// DEFERRED until ~mid-2027 — see plan WS2 Feature channel-payback-curve` marker at the call site location in `CustomerValueTab.tsx`.
- [ ] Commit: `git add src/lib/home/customerValue.ts src/lib/home/__tests__/customerValue.test.ts && git commit -m "feat(ws2): per-channel payback stub (deferred, returns deferred:true until 2027 maturity)"`

---

## Final integration gate (run before any push)

- [ ] Type check: `npm run build` (or the repo's `tsc --noEmit` script) — expect 0 errors.
- [ ] Node tests: `npm run test` — expect all PASS.
- [ ] DOM tests: `npm run test:components` — expect all PASS.
- [ ] Lint (incl. local guards `no-physical-direction-in-components`, `no-native-title-tooltip`, `no-hex-color-in-components`, the design-color green-ratchet): `npm run lint` — expect 0 errors.
- [ ] Docs-currency gate — UI changes: update `docs/ROAS-Dashboard-User-Manual.md` with the new "אמת לפי ערוץ" (per-channel truth) panel: per-channel NC-ROAS/nCAC, contribution-net (note fixed costs/salaries not split), and the quantified overcount. Bump the manual version.
- [ ] Docs-currency gate — lib/migration changes: update `docs/ARCHITECTURE.md` with `src/lib/home/channelTruth.ts` (the channel axis + mapping-aware spend derivation) and the deferred `acquiring_channel` column + its 2027 re-seed TODO.
- [ ] Commit docs: `git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md && git commit -m "docs(ws2): per-channel truth panel (User Manual) + channelTruth/cohort-channel (Architecture)"`

---

## Self-Review

**Spec coverage (all 4 gap ids):**
- `channel-nc-roas-split` → Feature 1 (Tasks 1.1–1.3, 2, 3, 4): `source` on `FirstOrderInput` + `computeNewCustomerMetrics` channel filter; `splitNewCustomerByChannel`; mapping-aware `spendByChannelFromCampaigns`; hero + store-modal panels. ✅
- `per-channel-net-profit` → Feature 2 (Tasks 2.1–2.2): `netByChannelFromCampaigns` contribution cascade; hero Net column + P&L sub-rows (combined ad-spend line preserved, no info loss). ✅
- `channel-overcount-delta` → Feature 4 (Tasks 4.1–4.2): `overcountByChannelFromCampaigns` rolls `analyzeAttribution`'s claim-vs-verified across campaigns per channel; hero Overcount column + drawer cross-link + quantified AI-report line replacing prose. ✅
- `channel-payback-curve` → Feature 3 (Tasks 3.1–3.2): marked LOW/DEFERRED; ship schema (nullable `acquiring_channel`) now, stub gated off, UI deferred to ~mid-2027 with documented re-seed. ✅

**Placeholder scan:** No "TODO" / "similar to Task N" / pseudo-code left as implementation. The two intentionally-partial items are explicitly bounded: (a) `toChannelTruthRows` may receive zero/null net+overcount maps until Features 2 & 4 land within the SAME plan (wired by Tasks 2.2 / 4.2) — sequencing, not a placeholder; (b) Feature 3's UI is a deliberate, documented defer with a working schema + a guarded stub + a test, not an unfinished stub. All test bodies + impl snippets are concrete and reference real files/line-ranges/functions (`newCustomerMetrics.ts:61-96`, `storeDetail.ts:193-218`, `attributionAnalysis.ts:334`, `analytics.ts:163-282`, `PnLBreakdown.tsx:264-271`, `aiReport.ts:166-173`, `customer_cohort_monthly` PK).

**Type consistency:** `PaidChannel`/`PAID_CHANNELS`/`SpendByChannel` are single-sourced in `channelTruth.ts` and reused by the panel, store-detail, and P&L props. The new `source?` field on `FirstOrderInput` is optional → every existing caller (Dashboard hero, storeDetail, customers tab) compiles unchanged; the new 5th param on `computeNewCustomerMetrics` is optional → byte-identical behavior when omitted (covered by the back-compat test). `ChannelTruthRow` (UI) is distinct from `ChannelNewCustomer` (compute) by design — the UI row flattens net+overcount onto the NC metrics for one render shape.

**Mapping-aware / CAPI-safe audit:** Every spend denominator flows through `campaignRows[].spend` (the mapping-aware source, via `spendByChannelFromCampaigns`), never `data_daily.fbSpend/gaSpend/ttSpend`. Channel revenue uses `conversionValue` (platform-attributed, mapping-aware) and `OrderAttributionRow.source`/`totalCad` (deterministic, mapping-aware). No write path to any pixel/CAPI is introduced anywhere.

**Token/a11y/RTL audit:** `ChannelTruthPanel` + P&L sub-rows use only token classes (`text-ink*`, `text-status-*`, `text-chart-*`), render numbers through `<Money>` (tabular-nums, compact, never clipped) and `bdi dir="ltr"` for ratios, carry `dir="rtl"`, and a DOM test asserts no `#rrggbb` hex leaks. Lint guards are run per-component and at the final gate (pass, not bypass).

---

## Open questions for the operator

1. **Per-channel net basis** — contribution net (revenue − spend − COGS − fees) excludes fixed costs + salaries because they aren't channel-attributable. Is contribution-net the number you want per channel, or should we evenly split fixed/salaries across channels by revenue share (less honest, but a "full" net)? Plan assumes contribution-net with a tooltip.
2. **Channel revenue basis for net** — should per-channel net use the platform-CLAIMED `conversionValue` (matches the per-platform ROAS already shown) or the click-ID-VERIFIED deterministic revenue (more honest, but lower)? Plan uses platform-claim for consistency with the existing per-platform ROAS; we can switch to verified or show both.
3. **Overcount sign convention** — plan reports overcount as `(claim − verified) / claim` clamped to ≥0 (halo where verified > claim shows 0%). Do you also want the halo case surfaced explicitly (e.g. "−15% (halo)") rather than collapsed to 0%?
4. **Panel placement** — under the hero NC tile AND in the store modal AND a P&L sub-section. Is that the right set of surfaces, or do you want a single dedicated location to avoid repetition?
5. **Payback defer** — confirm we ship only the nullable `acquiring_channel` schema + stub now and revisit the per-channel payback UI ~mid-2027 once channel-attributed cohorts mature (≥12 months from ~May 2026).
6. **AI-report prose replacement** — Feature 4 replaces the qualitative Meta-overcount disclaimer with quantified per-channel numbers. Keep the iOS14/modeled explanatory tail, or drop it entirely now that the numbers are concrete?
