# Activity-Feed Source/Platform Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the ad platform (Meta/Google/TikTok/direct) on each `sale` and `add_to_cart` event in the real-time activity feed.

**Architecture:** A new nullable `store_events.source` column. The canonical order→source classifier (`classifyOrderAttribution`, today in `shopify.ts`) is extracted to a shared, dependency-light module and reused by both ingest paths so the feed badge always matches the dashboard's attribution. Sales classify server-side from the order webhook (zero browser impact). Add-to-cart classifies from first-touch UTM/click-id captured by the storefront pixel/beacon (operator-deployed, async/fire-and-forget). The feed reuses the existing `PlatformBadge` primitive.

**Tech Stack:** Next.js/TypeScript, Supabase (Postgres), Vitest (node + dom), Shopify Custom Pixel.

**Spec:** `docs/superpowers/specs/2026-06-06-activity-feed-source-attribution-design.md`
**Approved mockup (concept):** `docs/superpowers/mockups/2026-06-06-activity-source-badge/feed-badges.html` (final chip uses the canonical `PlatformBadge` dot+label, not a filled pill).

**Conventions:** tests run `npx vitest run <file>` (node) / `npx vitest run --config vitest.config.dom.ts <file>` (dom) from `dashboard-web`. Migration written now, applied operator-gated (hide root `.env`, move the 2 duplicate-timestamp gap files, `supabase db push`, restore — see memory `reference-supabase-migration-procedure`). Deploy = one `git push origin main`. Per-task commits; Co-Author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File map
| File | Change |
|------|--------|
| `supabase/migrations/20260606140000_add_source_to_store_events.sql` | **Create** — `ADD COLUMN source` |
| `dashboard-web/src/lib/attribution/classifyOrderSource.ts` | **Create** — extracted classifier + `classifyOrderSource()` wrapper |
| `dashboard-web/src/lib/fetchers/shopify.ts` | **Modify** — import the moved classifier (behavior-preserving) |
| `dashboard-web/src/lib/webhooks/normalizeShopifyEvent.ts` | **Modify** — derive `source` for sales |
| `dashboard-web/src/lib/webhooks/store.ts` | **Modify** — `source` in `StoreEventRow` + feed columns |
| `dashboard-web/src/app/api/events/cart/route.ts` | **Modify** — classify ATC source from beacon |
| `dashboard-web/src/components/ui/SourceBadge.tsx` | **Create** — `source` → `PlatformBadge`/neutral chip mapper |
| `dashboard-web/src/components/home/ActivityFeed.tsx` | **Modify** — badge in `EventRow` |
| `dashboard-web/src/components/activity/ActivityEventsTab.tsx` | **Modify** — badge in `EventRow` |
| `docs/storefront-snippets/first-touch-attribution.md` | **Create** — operator-deployed pixel/beacon snippets |
| `docs/ROAS-Dashboard-User-Manual.md`, `docs/ARCHITECTURE.md` | **Modify** — docs |

---

### Task 1: Migration — `store_events.source`

**Files:** Create `supabase/migrations/20260606140000_add_source_to_store_events.sql`

- [ ] **Step 1:** Write the migration (additive, nullable; the feed reads the table directly via the service-role client, so NO view recreate is needed):

```sql
-- supabase/migrations/20260606140000_add_source_to_store_events.sql
-- Activity-feed source attribution (2026-06-06): per-event ad-platform source.
-- Values mirror OrderSource (meta-paid/google-paid/tiktok-paid/direct/…); null
-- for refunds + unclassified. Additive + nullable → no writer/reader breaks.
-- store_events is read directly (service-role) — no view to rebuild.
ALTER TABLE store_events ADD COLUMN IF NOT EXISTS source TEXT;
```

- [ ] **Step 2:** Verify file exists: `ls -1 supabase/migrations/20260606140000_add_source_to_store_events.sql`. DO NOT apply (operator-gated, Task 10).
- [ ] **Step 3:** Commit:
```bash
git add supabase/migrations/20260606140000_add_source_to_store_events.sql
git commit -m "feat(db): add store_events.source for activity-feed attribution"
```

---

### Task 2: Extract the canonical source classifier (behavior-preserving)

**Files:** Create `dashboard-web/src/lib/attribution/classifyOrderSource.ts`; Modify `dashboard-web/src/lib/fetchers/shopify.ts`

The classifier `classifyOrderAttribution` + helpers `safeDecode`, `fbcIsFreshClick`, const `FBC_CLICK_WINDOW_MS`, and the `ShopifyOrderPayload` type currently live in `shopify.ts` (~lines 820-`<end of classifyOrderAttribution>`). Move them verbatim to a dependency-light module so the webhook + cart routes can import the classifier without pulling the heavy `shopify.ts` fetcher graph.

- [ ] **Step 1:** Create `src/lib/attribution/classifyOrderSource.ts`. **Move VERBATIM** (no logic change) from `shopify.ts`: the `ShopifyOrderPayload` type, `safeDecode`, `FBC_CLICK_WINDOW_MS`, `fbcIsFreshClick`, and the entire `classifyOrderAttribution` function. Keep their `export` keywords. Add at the bottom a thin wrapper:

```ts
/**
 * Thin source-only wrapper for ingest paths (webhook sale + cart beacon) that
 * only need the resolved `source` label, not the full attribution object. Reuses
 * the SAME classifier the orders pipeline uses → the feed badge matches the
 * canonical dashboard attribution exactly.
 */
export function classifyOrderSource(input: {
  landing_site?: string | null;
  referring_site?: string | null;
  note_attributes?: Array<{ name?: string; value?: string }> | null;
  source_name?: string | null;
}): string {
  return classifyOrderAttribution({
    landing_site: input.landing_site ?? undefined,
    referring_site: input.referring_site ?? undefined,
    note_attributes: input.note_attributes ?? undefined,
    source_name: input.source_name ?? undefined,
  }).source;
}
```

- [ ] **Step 2:** In `shopify.ts`, delete the moved declarations and add, near the top imports:
```ts
import {
  classifyOrderAttribution,
  fbcIsFreshClick,
  type ShopifyOrderPayload,
} from '@/lib/attribution/classifyOrderSource';
```
Keep every existing `shopify.ts` call site unchanged (it already calls `classifyOrderAttribution(...)` / `fbcIsFreshClick(...)`). If `safeDecode`/`FBC_CLICK_WINDOW_MS` are referenced elsewhere in `shopify.ts`, also import them; otherwise leave them only in the new module.

- [ ] **Step 3:** Typecheck + the parity contract test (guards the move): `cd dashboard-web && npx tsc --noEmit && npx vitest run src/lib/__tests__/orderSourceContract.test.ts` (run whichever path the contract test lives at — `grep -rl orderSourceContract src`). Expected: exit 0 + PASS (no behavior change).
- [ ] **Step 4:** Commit:
```bash
git add dashboard-web/src/lib/attribution/classifyOrderSource.ts dashboard-web/src/lib/fetchers/shopify.ts
git commit -m "refactor(attribution): extract classifyOrderAttribution to shared module (+ source wrapper)"
```

---

### Task 3: Sale source at ingest (server-side)

**Files:** Modify `dashboard-web/src/lib/webhooks/normalizeShopifyEvent.ts`; Test `dashboard-web/src/lib/webhooks/__tests__/normalizeShopifyEvent.source.test.ts`

- [ ] **Step 1:** Write the failing test:
```ts
// dashboard-web/src/lib/webhooks/__tests__/normalizeShopifyEvent.source.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeOrderEvent } from '@/lib/webhooks/normalizeShopifyEvent';

const fx = async () => 1; // CAD passthrough-ish; not under test here

describe('normalizeOrderEvent — source', () => {
  it('classifies a Meta sale from landing_site fbclid', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '100', currency: 'CAD', created_at: '2026-06-06T10:00:00Z',
      landing_site: '/?fbclid=abc123', line_items: [{ title: 'X', quantity: 1 }],
    }, { storeId: 'uzoshop', webhookId: 'w1', cadConvert: fx });
    expect(ev?.source).toBe('meta-paid');
  });
  it('classifies a Google sale from gclid', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '50', currency: 'CAD', created_at: '2026-06-06T10:00:00Z',
      landing_site: '/?gclid=xyz', line_items: [],
    }, { storeId: 'uzoshop', webhookId: 'w2', cadConvert: fx });
    expect(ev?.source).toBe('google-paid');
  });
  it('direct sale with no signals → "direct"', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '20', currency: 'CAD', created_at: '2026-06-06T10:00:00Z', landing_site: '/',
    }, { storeId: 'uzoshop', webhookId: 'w3', cadConvert: fx });
    expect(ev?.source).toBe('direct');
  });
  it('refund sets source null', async () => {
    const ev = await normalizeOrderEvent('refund', {
      id: 1, created_at: '2026-06-06T10:00:00Z', transactions: [{ amount: '10', currency: 'CAD' }],
    }, { storeId: 'uzoshop', webhookId: 'w4', cadConvert: fx });
    expect(ev?.source ?? null).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL (`source` undefined). `npx vitest run src/lib/webhooks/__tests__/normalizeShopifyEvent.source.test.ts`
- [ ] **Step 3:** Implement. In `normalizeShopifyEvent.ts`:
  - Add the import: `import { classifyOrderSource } from '@/lib/attribution/classifyOrderSource';`
  - Add `source: string | null;` to the `NormalizedStoreEvent` interface (after `customer_label`).
  - Widen the `OrderPayload` interface to add: `landing_site?: string; referring_site?: string; note_attributes?: Array<{ name?: string; value?: string }>; source_name?: string;`
  - In the **sale** branch's returned object, add:
    ```ts
    source: classifyOrderSource({
      landing_site: order.landing_site,
      referring_site: order.referring_site,
      note_attributes: order.note_attributes,
      source_name: order.source_name,
    }),
    ```
  - In the **refund** branch's returned object, add `source: null,`.
- [ ] **Step 4:** Run → PASS (4/4). Then `npx tsc --noEmit`.
- [ ] **Step 5:** Commit:
```bash
git add dashboard-web/src/lib/webhooks/normalizeShopifyEvent.ts dashboard-web/src/lib/webhooks/__tests__/normalizeShopifyEvent.source.test.ts
git commit -m "feat(feed): classify sale source at webhook ingest"
```

---

### Task 4: Reader — surface `source`

**Files:** Modify `dashboard-web/src/lib/webhooks/store.ts`

- [ ] **Step 1:** Add `source: string | null;` to the `StoreEventRow` interface (after `customer_label`).
- [ ] **Step 2:** Add `source` to the feed columns constant:
```ts
const STORE_EVENT_FEED_COLUMNS =
  'id, store_id, type, amount_cad, currency, amount_original, product_title, quantity, customer_label, source, occurred_at, received_at';
```
(Both `readRecentStoreEvents` (home feed) and `readStoreEventsPaged` (Activity tab) use this constant → both feeds + the `/api/store-events` routes get `source` with no further change.)
- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 4:** Commit:
```bash
git add dashboard-web/src/lib/webhooks/store.ts
git commit -m "feat(feed): read store_events.source into StoreEventRow"
```

---

### Task 5: Add-to-cart source at ingest

**Files:** Modify `dashboard-web/src/app/api/events/cart/route.ts`; Test `dashboard-web/src/app/api/events/cart/__tests__/route.source.test.ts`

- [ ] **Step 1:** Write the failing test (assert the inserted event carries the classified source). Mirror the existing `events/cart/__tests__/route.test.ts` harness (it already mocks `lookupStoreByCartToken` + `insertStoreEvent`). New file:
```ts
// dashboard-web/src/app/api/events/cart/__tests__/route.source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: any[] = [];
vi.mock('@/lib/webhooks/store', () => ({
  lookupStoreByCartToken: vi.fn(async () => ({ store_id: 'uzoshop', allowed_origins: [], enabled: true })),
  insertStoreEvent: vi.fn(async (e: any) => { inserted.push(e); }),
}));

beforeEach(() => { inserted.length = 0; });

async function post(body: unknown) {
  const { POST } = await import('@/app/api/events/cart/route');
  return POST(new Request('https://x/api/events/cart', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('events/cart — source', () => {
  it('classifies TikTok from beacon first-touch ttclid', async () => {
    await post({ store_token: 't', event_id: 'e1', product_title: 'P', quantity: 1, landing_site: '/?ttclid=zzz' });
    expect(inserted[0].source).toBe('tiktok-paid');
  });
  it('no attribution → direct', async () => {
    await post({ store_token: 't', event_id: 'e2', product_title: 'P', quantity: 1 });
    expect(inserted[0].source).toBe('direct');
  });
});
```

- [ ] **Step 2:** Run → FAIL (`source` undefined). `npx vitest run src/app/api/events/cart/__tests__/route.source.test.ts`
- [ ] **Step 3:** Implement in `route.ts`:
  - Import: `import { classifyOrderSource } from '@/lib/attribution/classifyOrderSource';`
  - Widen the parsed `body` type to also read: `landing_site?: unknown; referring_site?: unknown; utm?: unknown;` plus click-ids are carried inside `landing_site` (the snippet builds a synthetic `landing_site` query string from the captured first-touch params — see Task 8), so reading `landing_site` is sufficient. Compute:
    ```ts
    const source = classifyOrderSource({
      landing_site: typeof body.landing_site === 'string' ? body.landing_site : null,
      referring_site: typeof body.referring_site === 'string' ? body.referring_site : null,
    });
    ```
  - Pass `source` into the existing `insertStoreEvent({ … })` call (add `source,`).
- [ ] **Step 4:** Run → PASS (2/2). `npx tsc --noEmit`.
- [ ] **Step 5:** Commit:
```bash
git add dashboard-web/src/app/api/events/cart/route.ts dashboard-web/src/app/api/events/cart/__tests__/route.source.test.ts
git commit -m "feat(feed): classify add-to-cart source from beacon first-touch"
```

---

### Task 6: `<SourceBadge>` primitive

**Files:** Create `dashboard-web/src/components/ui/SourceBadge.tsx`; Test `dashboard-web/src/components/ui/__tests__/SourceBadge.dom.test.tsx`

- [ ] **Step 1:** Write the failing DOM test:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SourceBadge } from '@/components/ui/SourceBadge';
afterEach(() => cleanup());

describe('SourceBadge', () => {
  it('renders Meta for meta-paid', () => {
    render(<SourceBadge source="meta-paid" />);
    expect(screen.getByText('Meta')).toBeInTheDocument();
  });
  it('renders Google for google-paid', () => {
    render(<SourceBadge source="google-paid" />);
    expect(screen.getByText('Google')).toBeInTheDocument();
  });
  it('renders a neutral "ישיר" chip for direct', () => {
    render(<SourceBadge source="direct" />);
    expect(screen.getByText('ישיר')).toBeInTheDocument();
  });
  it('renders nothing for null source', () => {
    const { container } = render(<SourceBadge source={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL (no module). `npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/SourceBadge.dom.test.tsx`
- [ ] **Step 3:** Implement:
```tsx
import { PlatformBadge } from '@/components/ui/PlatformBadge';

/** Map an OrderSource label to a paid/organic platform key, or null. */
function sourceToPlatform(source: string | null | undefined): 'meta' | 'google' | 'tiktok' | null {
  if (!source) return null;
  if (source.startsWith('meta')) return 'meta';
  if (source.startsWith('google')) return 'google';
  if (source.startsWith('tiktok')) return 'tiktok';
  return null;
}

/**
 * Per-event source/platform badge for the activity feed. Reuses the canonical
 * <PlatformBadge> (brand-mirrored chart-platform colors) for Meta/Google/TikTok;
 * shows a neutral "ישיר" chip for direct/other; renders NOTHING for null
 * (refunds / unknown). Token-only, RTL-safe.
 */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source == null) return null;
  const platform = sourceToPlatform(source);
  if (platform) return <PlatformBadge platform={platform} size="sm" data-testid="source-badge" />;
  return (
    <span
      data-testid="source-badge"
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold bg-glass-2 text-ink-secondary"
    >
      ישיר
    </span>
  );
}
```
(`direct`, `email`, `other-*`, organic-only-without-platform → neutral "ישיר". Tune later if organic should map to the platform dot.)

- [ ] **Step 4:** Run → PASS (4/4). `npx tsc --noEmit`.
- [ ] **Step 5:** Commit:
```bash
git add dashboard-web/src/components/ui/SourceBadge.tsx dashboard-web/src/components/ui/__tests__/SourceBadge.dom.test.tsx
git commit -m "feat(ui): SourceBadge primitive (reuses PlatformBadge)"
```

---

### Task 7: Render the badge in both feed surfaces

**Files:** Modify `dashboard-web/src/components/home/ActivityFeed.tsx` (`EventRow`, ~line 288-300) and `dashboard-web/src/components/activity/ActivityEventsTab.tsx` (`EventRow`, ~line 169-205); Test `dashboard-web/src/components/home/__tests__/activityFeedSource.dom.test.tsx`

- [ ] **Step 1:** Write the failing DOM test (home feed row shows the badge for a sale with source):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SourceBadge } from '@/components/ui/SourceBadge';
afterEach(() => cleanup());
// Lightweight guard: the feed row composes SourceBadge; verify the mapping the
// row relies on renders a Meta badge (full-feed SWR rendering is covered by the
// existing activity-feed tests; this pins the source wiring).
describe('activity feed source wiring', () => {
  it('a meta-paid event surfaces a Meta badge', () => {
    render(<SourceBadge source="meta-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('Meta');
  });
});
```
(If the existing `ActivityFeed` test harness can render a full row with a mocked event, prefer extending it to assert `getByTestId('source-badge')` appears on a sale row and is ABSENT on a refund row.)

- [ ] **Step 2:** Run → PASS already (SourceBadge exists). This task is the wiring; the guard is the SourceBadge contract. Proceed to wire.
- [ ] **Step 3:** In `ActivityFeed.tsx`: `import { SourceBadge } from '@/components/ui/SourceBadge';`. In `EventRow`, inside the metadata line (the `<div className="mt-1 flex items-center gap-2 text-[11px]">` that holds the store-chip), add AFTER the store-chip `</span>`, gated to non-refund:
```tsx
{ev.type !== 'refund' && <SourceBadge source={ev.source} />}
```
- [ ] **Step 4:** In `ActivityEventsTab.tsx`: same import; in its `EventRow`, next to the `data-testid="activity-store-chip"` chip, add the same `{ev.type !== 'refund' && <SourceBadge source={ev.source} />}`.
- [ ] **Step 5:** `npx tsc --noEmit` + run the feed DOM tests: `npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/ src/components/activity/__tests__/ src/components/ui/__tests__/SourceBadge.dom.test.tsx`. Expected: all PASS (existing feed tests still green; refund rows show no badge).
- [ ] **Step 6:** Commit:
```bash
git add dashboard-web/src/components/home/ActivityFeed.tsx dashboard-web/src/components/activity/ActivityEventsTab.tsx dashboard-web/src/components/home/__tests__/activityFeedSource.dom.test.tsx
git commit -m "feat(feed): show source/platform badge on sale + add-to-cart rows"
```

---

### Task 8: Storefront first-touch capture snippets (operator-deployed)

**Files:** Create `docs/storefront-snippets/first-touch-attribution.md`

These run on the storefronts (NOT in this repo's CI). They (a) on every page persist the FIRST-touch UTM/click-id, (b) on add-to-cart send them to `/api/events/cart` as a synthetic `landing_site` query string the server already knows how to classify. Off-main-thread (Custom Pixel) + fire-and-forget (must never block the storefront).

- [ ] **Step 1:** Create the doc with two snippets + deploy steps.

**Shopify Custom Pixel (uzoshop, Zol Plus)** — paste in Settings → Customer events → Add custom pixel:
```js
analytics.subscribe("page_viewed", (e) => {
  try {
    const url = new URL(e.context.document.location.href);
    const keep = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    const got = keep.filter(k => url.searchParams.get(k));
    if (got.length && !localStorage.getItem("_ft_attr")) {
      const qs = got.map(k => k + "=" + encodeURIComponent(url.searchParams.get(k))).join("&");
      localStorage.setItem("_ft_attr", "?" + qs); // first-touch only (guard above)
    }
  } catch (_) {}
});
analytics.subscribe("product_added_to_cart", (e) => {
  try {
    const ci = e.data?.cartLine?.merchandise?.product?.title || e.data?.productVariant?.product?.title || null;
    const qty = e.data?.cartLine?.quantity || 1;
    fetch("https://roas-dashboard-smoky.vercel.app/api/events/cart", {
      method: "POST", keepalive: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store_token: "<STORE_CART_TOKEN>", event_id: (e.id || (Date.now()+"-"+Math.random())),
        product_title: ci, quantity: qty, occurred_at: new Date().toISOString(),
        landing_site: localStorage.getItem("_ft_attr") || "/",
      }),
    }).catch(() => {});
  } catch (_) {}
});
```

**Lovable headless (usmile360)** — add to the storefront JS:
```js
(function () {
  try {
    var keep = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    var p = new URLSearchParams(location.search);
    var got = keep.filter(function (k) { return p.get(k); });
    if (got.length && !localStorage.getItem("_ft_attr")) {
      localStorage.setItem("_ft_attr", "?" + got.map(function (k){ return k+"="+encodeURIComponent(p.get(k)); }).join("&"));
    }
  } catch (_) {}
})();
// In the existing add-to-cart handler's beacon body, add:
//   landing_site: localStorage.getItem("_ft_attr") || "/"
```

Deploy steps: replace `<STORE_CART_TOKEN>` with each store's `cart_public_token` (from `store_webhooks`); paste per store; verify the first ATC after deploy lands with a non-null `source`. **Honest:** organic/direct landings → `direct`; Google first-click is weaker.

- [ ] **Step 2:** Commit:
```bash
git add docs/storefront-snippets/first-touch-attribution.md
git commit -m "docs(storefront): first-touch attribution capture snippets (operator-deployed)"
```

---

### Task 9: Docs + full gate + apply migration + deploy

**Files:** Modify `docs/ROAS-Dashboard-User-Manual.md` (version box + changelog), `docs/ARCHITECTURE.md`

- [ ] **Step 1:** User Manual: bump the version-box number one patch and add a top `## מה התחדש (…)` block describing the new per-event platform badge (sales server-side; add-to-cart needs the storefront snippet from Task 8; honest caveats). Keep box alignment.
- [ ] **Step 2:** ARCHITECTURE: note `store_events.source`, the `classifyOrderSource` extraction (shared by orders pipeline + webhook + cart), and `SourceBadge`.
- [ ] **Step 3:** Full gate (from `dashboard-web`): `npx tsc --noEmit && npm run test && npm run test:components && npm run lint`. Expected: tsc 0; both vitest green; lint 0 errors. STOP + report if anything fails.
- [ ] **Step 4:** Commit docs:
```bash
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md
git commit -m "docs: activity-feed source attribution (User Manual + ARCHITECTURE)"
```
- [ ] **Step 5 (operator-gated):** Apply migration `20260606140000` via the supervised procedure (hide root `.env`; move gap files `20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql` + `20260530310000_agg_data_daily_for_date.sql`; `npx supabase db push`; restore). Verify: `select source from store_events limit 1;` succeeds.
- [ ] **Step 6:** `git push origin main` (gate + Vercel deploy). Then the operator deploys the Task-8 storefront snippets and confirms a live ATC event carries `source`.

---

## Self-Review

**Spec coverage:** §A migration → T1. §B classifier extract → T2. §C sale ingest → T3. §F reader → T4. §D ATC ingest (server) → T5; ATC storefront snippets → T8. §E UI badge → T6 (primitive) + T7 (both surfaces). §G testing → T3/T5/T6/T7 + T9 gate. Docs/migration/deploy → T9. ✓

**Placeholder scan:** `<STORE_CART_TOKEN>` (Task 8) is an intentional operator-fill with instructions; `<ts>`/`<end of …>` in Task 2 reference an exact verbatim move by name. All NEW code is complete; the only "move by line-range" is the behavior-preserving extraction, guarded by the contract test. No TBD/TODO. ✓

**Type consistency:** `source: string | null` is consistent across `NormalizedStoreEvent` (T3), `StoreEventRow` + `STORE_EVENT_FEED_COLUMNS` (T4), `insertStoreEvent` payload (T3/T5), and `SourceBadge`'s `source` prop (T6) consumed in T7. `classifyOrderSource(input)` signature defined in T2 is called identically in T3 + T5. `sourceToPlatform` returns `'meta'|'google'|'tiktok'|null` fed to `PlatformBadge.platform`. ✓

**Open verify-at-impl:** Task 2 — confirm `safeDecode`/`FBC_CLICK_WINDOW_MS` aren't referenced elsewhere in `shopify.ts` before removing (grep); if they are, import them back. Task 7 — confirm the exact metadata-line JSX in both `EventRow`s before inserting (line numbers approximate).
