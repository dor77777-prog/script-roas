# UX & Workflow Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Close the 8 "UX & Workflow" gaps from the 2026-06-04 vetted gap audit — make the dashboard default to *today* on entry, give the operator explicit period-over-period comparison, CSV export from every rich table, named saved views, in-table free-text search, timeline annotations on the Trends chart (already device-synced — surface them), a cross-store comparison grid, and a deepened command palette (deep-link to a row, custom-range jump, missing Payments tab). Every change is READ-ONLY / CAPI-safe by construction (no pixel/CAPI writes; the only first-party demand signal allowed is the existing post-purchase survey via `note_attributes`, untouched here).

Architecture: Next.js (App Router) + TypeScript SPA under `dashboard-web/`. Hebrew RTL, single operator, 3 Shopify stores (uzoshop, zolplus="Zol Plus", usmile360="360usmile") × Meta/Google/TikTok, everything CAD. Global filter state lives in `Dashboard.tsx` React state, mirrored to the URL via `lib/urlState.ts` (`syncUrl`/`readDashboardState`) and to per-tab params (`syncTabLocalUrl`). Cross-device state rides `lib/cloudSync.ts` (`STATE_KEYS` + `pushCloudKey`) → `/api/dashboard-state` (allowlisted by `lib/dashboardStateKeys.ts:ALLOWED_STATE_KEYS`; parity enforced by `stateKeysParity.test.ts`). All per-store numbers MUST come from mapping-aware aggregates (`lib/analytics.ts` `aggregate` / `aggregateByStore`, fed by `data.rows` which is `/api/data` = `agg_data_daily_for_date` + `campaignStoreMap`) — never raw account totals.

Tech Stack: React 19 + Next 15/16, SWR, Recharts, lucide-react, Tailwind (token-driven via CSS variables in `globals.css`), vitest (node default `vitest.config.ts`, DOM `vitest.config.dom.ts`), Playwright (visual/axe), ESLint flat-config with local design-system guards (`no-physical-direction-in-components`, `no-native-title-tooltip`, `no-hex-color-in-components`, `no-cross-palette-import`, `no-raw-button/input/table-in-components`, `no-emoji-in-jsx`, the design-color green-ratchet). Shared UI primitives: `Money`/`MoneyAnimated`, `Button`, `Input`, `Card`, `TableBase`, `Badge`, `HelpTooltip`, `PlatformBadge`, `RoasBadge`, `Heading`.

Gate before any push (all must pass): `npm run -s tsc` *(use `npx tsc --noEmit -p dashboard-web/tsconfig.json` from repo root)*, `npm test` (node), `npm run test:components` (DOM), `npm run lint`, and the docs-currency pre-push gate — any UI/component change updates `docs/ROAS-Dashboard-User-Manual.md` (bump the גרסה header, currently 2.32.0); any `lib/`/inngest/migration change updates `docs/ARCHITECTURE.md` (currently גרסה 1.5). Commit per task; deploy = `git push origin main` only (Vercel Git integration) — do NOT also `vercel deploy --prod`. Prefer working directly on `main` (operator preference; do not branch).

---

## File Structure

Created:
- `dashboard-web/src/lib/savedViews.ts` — saved-view type + read/write/normalize + cloud push (mirrors `cogsSettings.ts`). One responsibility: persist/recall named tab+store+range+sort presets.
- `dashboard-web/src/lib/hooks/useSavedViews.ts` — reactive hook over `savedViews.ts` (mirrors `useCogsSettings.ts`).
- `dashboard-web/src/components/SavedViewsMenu.tsx` — header dropdown: list / apply / save-current / delete a view. Token-driven, RTL, light+dark.
- `dashboard-web/src/lib/csvExport.ts` — pure `toCsv(headers, rows)` + `downloadCsv(filename, csv)` (Blob/anchor pattern lifted from `AiReportButton.handleDownload`). One responsibility: serialize a 2-D matrix to RFC-4180 CSV + trigger a browser download.
- `dashboard-web/src/components/ui/ExportCsvButton.tsx` — shared "ייצא CSV" button primitive that takes a `() => { filename; headers; rows }` builder. One responsibility: the download affordance, reused by every table.
- `dashboard-web/src/components/StoreCompareGrid.tsx` — 3-stores-as-columns comparison grid (same metric rows). One responsibility: render `StoreAgg[]` (+ order counts + NC share) as comparable columns with best/worst emphasis.
- `dashboard-web/src/lib/filterByName.ts` — pure, accent/case-insensitive substring matcher used by every in-table name search. One responsibility: token match.
- `dashboard-web/src/lib/__tests__/savedViews.test.ts`, `csvExport.test.ts`, `filterByName.test.ts`, `compareBaseline.test.ts` — node tests.
- `dashboard-web/src/lib/__tests__/urlStateDefaultToday.dom.test.ts`, `commandPalettePerform.dom.test.ts` — DOM tests.
- `dashboard-web/src/components/__tests__/StoreCompareGrid.dom.test.tsx`, `SavedViewsMenu.dom.test.tsx`, `ExportCsvButton.dom.test.tsx`, `CampaignsTableSearch.dom.test.tsx`, `RoasChartAnnotations.dom.test.tsx` — DOM tests.
- `docs/superpowers/mockups/2026-06-04-ux-workflow/` — static HTML mockups (saved-views menu, store-compare grid, period-compare, in-table search bar, annotation overlay) opened via `open <abs-path>` for operator approval BEFORE building each UI feature.

Modified:
- `dashboard-web/src/lib/dateRange.ts` — `DEFAULT_PRESET` + default-today semantics (gap ux-home-default-today).
- `dashboard-web/src/lib/urlState.ts` — default preset `today`; URL omission anchored on the new default; `drillToCampaigns` already exposes `campaign` (reused by palette).
- `dashboard-web/src/components/Dashboard.tsx` — `initialPreset='today'`; period-compare state + wiring; StoreCompareGrid mount; CSV export wiring on Detail; annotations onto Trends `RoasChart`.
- `dashboard-web/src/lib/presets.ts` — `COMPARISON_BASELINES` + `resolveCompareRange` (explicit baseline, gap ux-period-compare).
- `dashboard-web/src/lib/types.ts` — `Filters.compareBaseline?` + `CompareBaseline` union.
- `dashboard-web/src/components/Filters.tsx` — optional compare-baseline selector.
- `dashboard-web/src/components/RoasChart.tsx` — annotation `ReferenceLine` overlay (gap ux-annotations-on-trends).
- `dashboard-web/src/components/AnalysisTrendsTab.tsx` — pass annotations into `RoasChart`.
- `dashboard-web/src/components/CampaignsTable.tsx` — name-search input + filter (gap ux-table-search) + CSV export button.
- `dashboard-web/src/components/ProductsTable.tsx` — name-search input + filter + CSV export button.
- `dashboard-web/src/components/DetailTable.tsx` — CSV export button.
- `dashboard-web/src/components/CommandPalette.tsx` — campaign/product deep-link drill, Payments tab entry, custom-range jump, remove the stubbed "Plan 2" AI slot copy (gap ux-command-palette-actions).
- `docs/ROAS-Dashboard-User-Manual.md`, `docs/ARCHITECTURE.md` — per gate.

---

### Feature: Home page must DEFAULT to the today date range on entry (gap `ux-home-default-today`)
Impact: high · Effort: S · CAPI-safe: yes (pure client state) · Dependencies: none (do FIRST — Wave-1 quick win + operator hard requirement). Other WS6 features build on top but don't block this.

Background (grounded): `Dashboard.tsx:125` sets `const initialPreset = 'this_month'`; the filters init at `Dashboard.tsx:177-185` and `:165-174` (`activeTab` init) seed `computePresetRange(initialPreset)`. `urlState.ts:71-72` defaults the preset to `defaults.filters.preset` when `?preset=` is absent, and `writeDashboardState` (`urlState.ts:121`) OMITS `?preset=` only when it equals the literal `'this_month'`. So three coordinated edits are required: (1) flip the default preset to `today`, (2) make `writeDashboardState` omit the param for the NEW default (so a fresh today-view URL stays clean), and (3) ensure a deep-link carrying `?preset=this_month` (or `?preset=custom&from=&to=`) is still honored — `readDashboardState` already honors any explicit `?preset=`, so the only risk is the omission constant drifting. `computePresetRange('today')` (`presets.ts:90-92`) returns `{from: ilToday, to: ilToday}` — the single current-IL-day. `getTodayInIsraelTz()` in `dateRange.ts:143` confirms the IL-today anchor.

#### Task 1 — Introduce `DEFAULT_PRESET` constant in `dateRange.ts` (single source of truth)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/dateRange.defaultPreset.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { DEFAULT_PRESET } from '@/lib/dateRange';

  describe('DEFAULT_PRESET', () => {
    it('is "today" — the operator-required default on entry', () => {
      expect(DEFAULT_PRESET).toBe('today');
    });
  });
  ```
- [ ] Run it (expect FAIL — export missing): `cd dashboard-web && npx vitest run src/lib/__tests__/dateRange.defaultPreset.test.ts`
- [ ] Minimal impl — add to `dashboard-web/src/lib/dateRange.ts` (after the `DEFAULT_RANGE_DAYS` line, ~`:20`):
  ```ts
  import type { PresetKey } from './types';

  /**
   * Operator hard requirement (2026-06-04): the dashboard MUST open on the
   * single current-IL-day ("today") preset when no explicit range is in the
   * URL — NOT last-90-days, NOT this-month. A deep-link carrying ?preset= (or
   * ?preset=custom&from=&to=) is still honored by readDashboardState. This is
   * the ONE source of truth for that default; Dashboard.tsx + urlState.ts both
   * read it so the init value and the URL-omission constant can never drift.
   */
  export const DEFAULT_PRESET: PresetKey = 'today';
  ```
  (Note: `parseRangeParams`/`defaultRange` server semantics are unchanged — those govern API payload windows, not the client's opening preset. We are NOT changing `DEFAULT_RANGE_DAYS`.)
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run src/lib/__tests__/dateRange.defaultPreset.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): DEFAULT_PRESET=today constant (operator hard requirement)"`

#### Task 2 — `Dashboard.tsx` opens on today + `urlState` omits the param for the new default
- [ ] Write failing DOM test `dashboard-web/src/lib/__tests__/urlStateDefaultToday.dom.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { readDashboardState, writeDashboardState, type DashboardState } from '../urlState';
  import { DEFAULT_PRESET } from '../dateRange';
  import { computePresetRange } from '../presets';

  const DEFAULTS: DashboardState = {
    tab: 'home',
    filters: { preset: DEFAULT_PRESET, range: computePresetRange(DEFAULT_PRESET), store: 'All' },
  };
  beforeEach(() => window.history.replaceState(null, '', '/'));

  describe('default-today URL semantics', () => {
    it('no ?preset= → preset defaults to today (single current IL day)', () => {
      const s = readDashboardState(DEFAULTS, '');
      expect(s.filters.preset).toBe('today');
      expect(s.filters.range.from).toBe(s.filters.range.to);
    });
    it('writeDashboardState omits ?preset= when preset is today (clean URL)', () => {
      const out = writeDashboardState(
        { tab: 'home', filters: { preset: 'today', range: computePresetRange('today'), store: 'All' } },
        '',
      );
      expect(out).not.toContain('preset=today');
    });
    it('a deep-link carrying ?preset=this_month is HONORED (not overridden)', () => {
      const s = readDashboardState(DEFAULTS, '?preset=this_month');
      expect(s.filters.preset).toBe('this_month');
    });
    it('a deep-link carrying ?preset=custom&from&to is HONORED', () => {
      const s = readDashboardState(DEFAULTS, '?preset=custom&from=2026-05-01&to=2026-05-10');
      expect(s.filters.preset).toBe('custom');
      expect(s.filters.range).toEqual({ from: '2026-05-01', to: '2026-05-10' });
    });
    it('round-trip: write today then read back → still today', () => {
      const url = writeDashboardState(
        { tab: 'home', filters: { preset: 'today', range: computePresetRange('today'), store: 'All' } },
        '',
      );
      expect(readDashboardState(DEFAULTS, url).filters.preset).toBe('today');
    });
  });
  ```
- [ ] Run it (expect FAIL — omission still keyed to 'this_month'): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/urlStateDefaultToday.dom.test.ts`
- [ ] Minimal impl A — `dashboard-web/src/lib/urlState.ts`: import the constant and use it in `writeDashboardState`. Replace line `import { computePresetRange } from './presets';` region by adding `import { DEFAULT_PRESET } from './dateRange';` near the top, then change `urlState.ts:121`:
  ```ts
  // BEFORE: if (state.filters.preset !== 'this_month') params.set('preset', state.filters.preset);
  if (state.filters.preset !== DEFAULT_PRESET) params.set('preset', state.filters.preset);
  ```
- [ ] Minimal impl B — `dashboard-web/src/components/Dashboard.tsx:125`: `const initialPreset = 'this_month';` → import + use the constant:
  ```ts
  import { DEFAULT_PRESET, getTodayInIsraelTz, ... } from '@/lib/dateRange'; // extend the existing dateRange import
  const initialPreset = DEFAULT_PRESET;
  ```
  The three call sites (`:170`, `:179-180`, `:361`) already read `initialPreset`/`computePresetRange(initialPreset)`, so they now seed `today` with no further edits.
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/urlStateDefaultToday.dom.test.ts && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/urlState.dom.test.ts`
  (NOTE: the existing `urlState.dom.test.ts` uses `this_month` in its DEFAULTS literal — that test asserts `readDashboardState` echoes the *passed* default when no param is present, which still holds. If any existing assertion encoded the OLD omission constant, update it to `DEFAULT_PRESET` in the same commit.)
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — in the date-range section, note "ברירת המחדל בכניסה לדשבורד: היום (היום הנוכחי בלבד). קישור עם טווח מפורש ב-URL נשמר כפי שהוא." + bump גרסה header to 2.33.0.
- [ ] Run full gate: `cd dashboard-web && npx tsc --noEmit && npm test && npm run test:components && npm run lint`
- [ ] Commit: `git add -A && git commit -m "feat(ux): home defaults to today on entry; honor explicit deep-link ranges (ux-home-default-today)"`

---

### Feature: CSV/Excel export of any data table (gap `ux-csv-export`)
Impact: medium · Effort: S · CAPI-safe: yes (client-side serialize of already-rendered, mapping-aware rows) · Dependencies: none.

Background (grounded): no export exists anywhere — `AiReportButton.tsx:144` (`handleDownload`) is the only blob-download in the app (markdown); `BillingCsvImport.tsx` only imports. `DetailTable.tsx` renders `DailyRow[]` (already COGS/salary-adjusted upstream), `CampaignsTable.tsx` renders the mapping-resolved `aggregatedFiltered` rows, `ProductsTable.tsx` renders product buckets. We add a pure CSV serializer + a shared button, then wire the three rich tables to export EXACTLY the visible (mapping-aware, filtered) rows. Excel opens CSV natively — "CSV/Excel" is satisfied by a UTF-8 CSV with a BOM so Hebrew headers render correctly in Excel.

#### Task 3 — Pure CSV serializer (`lib/csvExport.ts`)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/csvExport.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { toCsv } from '@/lib/csvExport';

  describe('toCsv', () => {
    it('joins headers + rows with CRLF and a UTF-8 BOM prefix (Excel-safe)', () => {
      const out = toCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
      expect(out.startsWith('﻿')).toBe(true);
      expect(out).toBe('﻿a,b\r\n1,2\r\n3,4');
    });
    it('quotes fields containing comma, quote, or newline (RFC 4180)', () => {
      const out = toCsv(['x'], [['a,b'], ['he said "hi"'], ['line1\nline2']]);
      expect(out).toContain('"a,b"');
      expect(out).toContain('"he said ""hi"""');
      expect(out).toContain('"line1\nline2"');
    });
    it('coerces numbers without quoting and renders null/undefined as empty', () => {
      const out = toCsv(['n', 'm'], [[42, null], [0, undefined]]);
      expect(out).toContain('42,');
      expect(out).toContain('0,');
    });
    it('preserves Hebrew header text verbatim', () => {
      expect(toCsv(['הוצאה'], [['x']])).toContain('הוצאה');
    });
  });
  ```
- [ ] Run it (expect FAIL — module missing): `cd dashboard-web && npx vitest run src/lib/__tests__/csvExport.test.ts`
- [ ] Minimal impl — create `dashboard-web/src/lib/csvExport.ts`:
  ```ts
  /**
   * Pure CSV serialization + browser download. CAPI-safe / READ-ONLY: the
   * caller passes already-rendered, mapping-aware rows (the SAME visible row
   * set the table draws — never raw account totals). Excel opens UTF-8 CSV
   * natively; the leading BOM makes Hebrew headers render correctly there.
   */
  export type CsvCell = string | number | null | undefined;

  function escapeCell(cell: CsvCell): string {
    if (cell === null || cell === undefined) return '';
    const s = String(cell);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** RFC-4180 CSV string (CRLF rows) with a UTF-8 BOM so Excel reads Hebrew. */
  export function toCsv(headers: string[], rows: CsvCell[][]): string {
    const lines = [headers.map(escapeCell).join(',')];
    for (const r of rows) lines.push(r.map(escapeCell).join(','));
    return '﻿' + lines.join('\r\n');
  }

  /** Trigger a client-side download. No-op on the server. */
  export function downloadCsv(filename: string, csv: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  ```
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run src/lib/__tests__/csvExport.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): pure toCsv + downloadCsv (Excel-safe UTF-8 BOM)"`

#### Task 4 — Shared `<ExportCsvButton>` primitive
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ExportCsvButton.dom.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { ExportCsvButton } from '@/components/ui/ExportCsvButton';

  describe('ExportCsvButton', () => {
    beforeEach(() => {
      // jsdom lacks createObjectURL; stub so downloadCsv doesn't throw.
      // @ts-expect-error test stub
      URL.createObjectURL = vi.fn(() => 'blob:x');
      // @ts-expect-error test stub
      URL.revokeObjectURL = vi.fn();
      HTMLAnchorElement.prototype.click = vi.fn();
    });
    it('renders the Hebrew "ייצא CSV" label and is a real <button>', () => {
      render(<ExportCsvButton build={() => ({ filename: 'x', headers: ['a'], rows: [['1']] })} />);
      const btn = screen.getByRole('button', { name: /ייצא CSV/ });
      expect(btn.tagName).toBe('BUTTON');
    });
    it('calls the build fn on click (lazy — not on render)', () => {
      const build = vi.fn(() => ({ filename: 'x', headers: ['a'], rows: [['1']] }));
      render(<ExportCsvButton build={build} />);
      expect(build).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /ייצא CSV/ }));
      expect(build).toHaveBeenCalledTimes(1);
    });
    it('is disabled when disabled=true (empty table)', () => {
      render(<ExportCsvButton disabled build={() => ({ filename: 'x', headers: [], rows: [] })} />);
      expect(screen.getByRole('button', { name: /ייצא CSV/ })).toBeDisabled();
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/ExportCsvButton.dom.test.tsx`
- [ ] Minimal impl — create `dashboard-web/src/components/ui/ExportCsvButton.tsx`:
  ```tsx
  'use client';
  import { Download } from 'lucide-react';
  import { Button } from '@/components/ui/Button';
  import { HelpTooltip } from '@/components/ui/Tooltip';
  import { toCsv, downloadCsv, type CsvCell } from '@/lib/csvExport';

  export interface CsvPayload {
    filename: string;
    headers: string[];
    rows: CsvCell[][];
  }

  interface Props {
    /** Lazy — invoked on click so we serialize only the CURRENT visible rows. */
    build: () => CsvPayload;
    disabled?: boolean;
    className?: string;
  }

  /** Shared "ייצא CSV" affordance for every rich table. Token-driven, RTL. */
  export function ExportCsvButton({ build, disabled, className }: Props) {
    return (
      <HelpTooltip content="הורד את השורות המוצגות כקובץ CSV (נפתח גם ב-Excel)">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={className}
          onClick={() => {
            const { filename, headers, rows } = build();
            downloadCsv(filename, toCsv(headers, rows));
          }}
          aria-label="ייצא CSV"
        >
          <Download size={14} />
          <span className="hidden sm:inline">ייצא CSV</span>
        </Button>
      </HelpTooltip>
    );
  }
  ```
  (Uses the `Button`/`HelpTooltip` primitives — satisfies `no-raw-button-in-components`; no hardcoded colors; logical `hidden sm:inline` only.)
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/ExportCsvButton.dom.test.tsx`
- [ ] Commit: `git add -A && git commit -m "feat(ux): shared ExportCsvButton primitive"`

#### Task 5 — Wire export into DetailTable, CampaignsTable, ProductsTable
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/DetailTableExport.dom.test.tsx` that renders `DetailTable` with 2 `DailyRow`s and asserts a button named `/ייצא CSV/` is present (smallest of the three; mirror its `DailyRow` fixture from `DetailTable`'s existing render path):
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { DetailTable } from '@/components/DetailTable';
  import type { DailyRow } from '@/lib/types';

  const row = (over: Partial<DailyRow>): DailyRow => ({
    date: '2026-05-01', storeName: 'uzoshop', revenue: 100, grossRevenue: 100,
    spend: 40, fbSpend: 40, gaSpend: 0, ttSpend: 0, roas: 2.5, cogs: 25,
    netProfit: 35, ...over,
  } as DailyRow);

  describe('DetailTable CSV export', () => {
    it('shows an export button when there are rows', () => {
      render(<DetailTable rows={[row({}), row({ date: '2026-05-02' })]} bare />);
      expect(screen.getByRole('button', { name: /ייצא CSV/ })).toBeInTheDocument();
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/DetailTableExport.dom.test.tsx`
- [ ] Minimal impl — `DetailTable.tsx`: import `ExportCsvButton`, and render it in the header (next to the `Heading`, both `bare` and card paths). Build the payload from the SAME `display`/`sorted` rows the table draws so the export matches the screen exactly:
  ```tsx
  import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
  // ...inside DetailTable, after `display` is computed:
  const csvBuild = () => ({
    filename: `detail_${display[0]?.date ?? 'rows'}_${display[display.length - 1]?.date ?? ''}`,
    headers: ['תאריך', 'חנות', 'הכנסה', 'הוצאה', 'ROAS', 'COGS', 'רווח נטו'],
    rows: display.map(r => [r.date, r.storeName, r.revenue, r.spend, r.roas, r.cogs, r.netProfit]),
  });
  // render <ExportCsvButton build={csvBuild} disabled={display.length === 0} /> in the title row.
  ```
- [ ] Run that test (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/DetailTableExport.dom.test.tsx`
- [ ] Repeat for `CampaignsTable.tsx`: add an `<ExportCsvButton>` in the toolbar (`renderToolbar` region ~`:1533`, next to `CampaignsColumnsMenu`). Build from `aggregatedFiltered` (the visible, mapping-resolved, multi-mapped-filtered, name-search-filtered set — see Task 13; place this wiring AFTER Task 13 lands so the export honors the search filter, or build from `aggregatedFiltered` now and it auto-narrows once search is added). Headers (Hebrew): `['שם', 'פלטפורמה', 'חנות', 'הוצאה', 'ערך המרות', 'ROAS', 'המרות', 'קליקים', 'CTR', 'CPM']`; rows map each `a` via the same fields the body cells render (`a.campaignName`/`a.adSetName`, `a.platform`, resolved store, `a.spend`, `a.conversionValue`, `a.roas`, `a.conversions`, `a.clicks`, `a.ctr`, `a.cpm`). Filename `campaigns_${mode}_${localRange.from}_${localRange.to}`.
- [ ] Repeat for `ProductsTable.tsx`: add `<ExportCsvButton>` in the `toolbar` (~`:370`). Build from the visible product buckets (the `filtered`/bucket rows the table draws). Headers `['מוצר', 'חנות', 'יחידות', 'הכנסה']`; filename `products_${period}_${range.from}_${range.to}`.
- [ ] Run full DOM suite for touched files: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/DetailTableExport.dom.test.tsx src/components/__tests__/ExportCsvButton.dom.test.tsx`
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — add "ייצוא CSV" subsection (Detail / Campaigns / Products tables; exports exactly the visible filtered rows; opens in Excel) + bump גרסה.
- [ ] Run full gate (tsc + both vitest + lint).
- [ ] Commit: `git add -A && git commit -m "feat(ux): CSV export on Detail/Campaigns/Products tables (ux-csv-export)"`

---

### Feature: In-table free-text search/filter for Campaigns, Products & Ads (gap `ux-table-search`)
Impact: medium · Effort: S · CAPI-safe: yes · Dependencies: none (Task 5 CampaignsTable export should narrow with this filter — sequence Task 13 before/with the CampaignsTable export wiring).

Background (grounded): free-text matching exists ONLY in `CommandPalette.tsx` (which navigates away). `CampaignsTable.tsx` has sort (`SortKey`) + platform tabs + the "🔗 multi-mapped only" checkbox (~`:1486`) but NO name-search input; the visible set is `aggregatedFiltered` (`:825-828`). Row name is `a.campaignName` / `a.adSetName` (`:180`). `ProductsTable.tsx` filters product buckets (`:145`) but has no text input. The Ads drawer (`AdsDrawer`, opened from `CampaignsTable`) renders ad-set/ad rows. We add a tiny pure matcher + a search `<Input>` to each.

#### Task 6 — Pure name matcher (`lib/filterByName.ts`)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/filterByName.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { matchesNameQuery } from '@/lib/filterByName';

  describe('matchesNameQuery', () => {
    it('empty query matches everything', () => {
      expect(matchesNameQuery('Anything', '')).toBe(true);
      expect(matchesNameQuery('', '   ')).toBe(true);
    });
    it('case-insensitive substring on a single token', () => {
      expect(matchesNameQuery('Summer Sale 2026', 'sale')).toBe(true);
      expect(matchesNameQuery('Summer Sale 2026', 'SALE')).toBe(true);
      expect(matchesNameQuery('Summer Sale 2026', 'winter')).toBe(false);
    });
    it('all whitespace tokens must match (AND)', () => {
      expect(matchesNameQuery('Meta Retargeting v3', 'meta v3')).toBe(true);
      expect(matchesNameQuery('Meta Retargeting v3', 'meta v9')).toBe(false);
    });
    it('matches Hebrew product titles', () => {
      expect(matchesNameQuery('מברשת שיניים חשמלית', 'שיניים')).toBe(true);
    });
    it('treats null/undefined haystack as empty (no match unless query empty)', () => {
      expect(matchesNameQuery(undefined, 'x')).toBe(false);
      expect(matchesNameQuery(null, '')).toBe(true);
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run src/lib/__tests__/filterByName.test.ts`
- [ ] Minimal impl — create `dashboard-web/src/lib/filterByName.ts`:
  ```ts
  /**
   * Pure, case-insensitive, whitespace-AND substring matcher for in-table
   * name search (Campaigns / Products / Ads). Mirrors the token scoring in
   * CommandPalette but stays local-filter only (never navigates). READ-ONLY.
   */
  export function matchesNameQuery(haystack: string | null | undefined, query: string): boolean {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const hay = (haystack ?? '').toLowerCase();
    return tokens.every(t => hay.includes(t));
  }
  ```
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run src/lib/__tests__/filterByName.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): pure matchesNameQuery helper for in-table search"`

#### Task 7 — Name-search input in CampaignsTable
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/CampaignsTableSearch.dom.test.tsx`. Mirror the existing CampaignsTable DOM test setup (find one under `src/components/__tests__/` that renders `CampaignsTable` with a mocked `/api/campaigns` payload; reuse its fixture + SWR mock). Assert: typing "winter" in the search input narrows the rendered rows to only campaigns whose name contains "winter", and the visible-count chip updates. If no existing CampaignsTable DOM harness exists, assert at the unit boundary instead by extracting the search-applied filter into a tested `useMemo` selector — but PREFER the DOM render test:
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen, fireEvent, within } from '@testing-library/react';
  // ...import CampaignsTable + the project's standard SWR/test wrapper + fixture
  it('narrows visible campaigns to the name query', async () => {
    // render with rows: "Winter Promo" + "Summer Sale"
    // type "winter" into getByPlaceholderText(/חפש שם/)
    // expect "Winter Promo" present, "Summer Sale" absent
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/CampaignsTableSearch.dom.test.tsx`
- [ ] Minimal impl — `CampaignsTable.tsx`:
  - Add state near the other filter state (~`:729`): `const [nameQuery, setNameQuery] = useState('');`
  - Apply it where `aggregatedFiltered` is computed (`:825-828`) — extend the memo:
    ```ts
    const aggregatedFiltered = useMemo(() => {
      let list = showOnlyMultiMapped
        ? aggregated.filter(a => multiMappedCampaignKeys.has(a.key))
        : aggregated;
      if (nameQuery.trim()) {
        list = list.filter(a =>
          matchesNameQuery(mode === 'campaign' ? a.campaignName : a.adSetName, nameQuery),
        );
      }
      return list;
    }, [aggregated, showOnlyMultiMapped, multiMappedCampaignKeys, nameQuery, mode]);
    ```
    (import `matchesNameQuery` from `@/lib/filterByName`.)
  - Add a search `<Input type="search">` to the toolbar (near the platform tabs ~`:1455`), placeholder `חפש שם קמפיין…` (or `חפש שם אד-סט…` when `mode==='adset'`), bound to `nameQuery`/`setNameQuery`. Use the `Input` primitive (satisfies `no-raw-input-in-components`); logical spacing classes only; clear-on-empty is implicit.
  - The visible-count chip (`:1529`) already reads `aggregatedFiltered.length` indirectly — verify it reflects the narrowed set (it uses `showOnlyMultiMapped ? aggregatedFiltered.length : aggregated.length`; change the false branch to also show `aggregatedFiltered.length` when `nameQuery` is non-empty so the count never disagrees with the body).
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/CampaignsTableSearch.dom.test.tsx`
- [ ] Commit: `git add -A && git commit -m "feat(ux): in-table name search for Campaigns/Ad-sets (ux-table-search)"`

#### Task 8 — Name-search input in ProductsTable + Ads drawer
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductsTableSearch.dom.test.tsx` (mirror Task 7; assert typing narrows visible product buckets by `productTitle`).
- [ ] Run it (expect FAIL).
- [ ] Minimal impl — `ProductsTable.tsx`: add `nameQuery` state, a search `<Input>` in the `toolbar` (~`:370`), and apply `matchesNameQuery(r.productTitle, nameQuery)` inside the existing visible-rows filter (`:145` / the bucket-product loop). Keep the bucket structure; filter products within buckets and drop empty buckets so the layout stays clean.
- [ ] Minimal impl — Ads drawer: locate the ad-set/ad row list inside `AdsDrawer` (opened from `CampaignsTable` via `adDrill`). Add the same `nameQuery` state + search `<Input>` + `matchesNameQuery(row.adSetName ?? row.adName, nameQuery)` filter over its visible rows. (If `AdsDrawer` is a separate file, edit it directly; mirror the placeholder pattern `חפש שם…`.)
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/ProductsTableSearch.dom.test.tsx`
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — add "חיפוש בטבלה" note (Campaigns / Ad-sets / Products / Ads drawer) + bump גרסה.
- [ ] Run full gate.
- [ ] Commit: `git add -A && git commit -m "feat(ux): in-table name search for Products + Ads drawer (ux-table-search)"`

---

### Feature: Deepen command palette — deep-link to a row, custom-range jump, missing Payments tab (gap `ux-command-palette-actions`)
Impact: low · Effort: S · CAPI-safe: yes · Dependencies: none. Reuses `drillToCampaigns(opts.campaign)` already in `urlState.ts:449-501` (currently UNUSED by the palette).

Background (grounded): `CommandPalette.tsx` campaign result `perform` (`:318-322`) only `setFilters({store})` + `setActiveTab('campaigns')` — it does NOT use `drillToCampaigns` to open the specific row's drawer. Product `perform` (`:379-383`) similarly only navigates. The nav set (`tabs` array ~`:185-195`) lists home/activity/customers/archive/pnl/trends/campaigns/products/detail but OMITS `payments` (a real top-level `TabKey`). There's no "jump to custom range" entry. The NL slot (`:608-615`) renders "— יזמין ב-Plan 2".

#### Task 9 — Campaign result deep-links to the exact campaign drawer; add Payments tab
- [ ] Write failing DOM test `dashboard-web/src/lib/__tests__/commandPalettePerform.dom.test.ts` testing the URL effect of a campaign deep-link via `drillToCampaigns` (the helper the palette will now call), since the palette `perform` is otherwise a closure. Assert the helper writes `c_drill` for a campaign and that a `payments` tab `TabKey` is valid:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { drillToCampaigns } from '../urlState';
  beforeEach(() => window.history.replaceState(null, '', '/'));
  it('drillToCampaigns with a campaign writes c_drill (deep-link to row)', () => {
    drillToCampaigns({ store: 'uzoshop', platform: 'meta',
      campaign: { storeId: 'uzoshop', platform: 'meta', campaignId: 'c123' } });
    const p = new URLSearchParams(window.location.search);
    expect(p.get('tab')).toBe('campaigns');
    expect(p.get('c_drill')).toBe('uzoshop::Meta::c123');
  });
  ```
  (This validates the wiring contract the palette relies on; the palette change itself is covered by the existing palette render tests if present + the manual gate.)
- [ ] Run it (expect PASS already — `drillToCampaigns` exists — so ALSO add a failing assertion that the palette exposes a Payments nav entry. Prefer a render test if a `CommandPalette` DOM harness exists; otherwise assert against a small extracted `buildNavTabs()` array that includes `payments`.) Concretely, extract the `tabs` array into a tested pure function `buildNavTabs(): {key:TabKey;...}[]` exported from `CommandPalette.tsx` (or a sibling `commandPaletteNav.ts`) and test it lists `payments`:
  ```ts
  import { buildNavTabs } from '@/components/commandPaletteNav';
  it('command palette nav includes the payments tab', () => {
    expect(buildNavTabs().map(t => t.key)).toContain('payments');
  });
  ```
- [ ] Run it (expect FAIL — payments missing / function missing): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/commandPalettePerform.dom.test.ts`
- [ ] Minimal impl:
  - In `CommandPalette.tsx`, add the Payments entry to the `tabs` array (~`:194`, after `detail`):
    ```tsx
    { key: 'payments', label: 'מעבר ל-תשלומים', icon: <Receipt size={15} />, search: 'תשלומים payments אמצעי תשלום payment methods' },
    ```
    (`Receipt` is already imported. Keep `pnl`'s icon — both use Receipt; that's acceptable, or swap pnl to a different lucide icon already imported.)
  - Change the campaign `perform` (`:318-322`) to deep-link to the exact campaign drawer using the existing helper:
    ```tsx
    perform: () => {
      drillToCampaigns({
        store: c.store,
        platform: c.platform.toLowerCase() as 'meta' | 'google' | 'tiktok',
        campaign: { storeId: c.storeId ?? c.store, platform: c.platform.toLowerCase() as 'meta'|'google'|'tiktok', campaignId: c.campaignId },
      });
      close();
    },
    ```
    (import `drillToCampaigns` from `@/lib/urlState`. NOTE: the agg map `c` currently carries `campaignId`, `store` (display), `platform` — confirm `storeId` is available from `campaigns.rows[i].storeId` and thread it into the agg `Map` value at `:275-286` so the drill uses the canonical storeId the drawer matches on. If only display store is available, pass the display store as `storeId` only when it equals the canonical id; otherwise add `storeId` to the agg to be safe.)
  - For the product `perform` (`:379-383`): keep `setStore + setActiveTab('products')` (Products has no row-drawer to deep-link), which is correct; no change required beyond leaving it.
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/commandPalettePerform.dom.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): palette deep-links to campaign drawer + Payments tab entry (ux-command-palette-actions)"`

#### Task 10 — "Jump to custom range" entry + retire the Plan-2 stub copy
- [ ] Write failing DOM test (extend `commandPalettePerform.dom.test.ts`) asserting a preset/action with `id='preset-custom'` (or `action-custom-range`) exists in the palette command set. Easiest: extract a tested `buildTimeCommands(setFilters, filters, close)` or assert the `custom` preset is now offered (the current code `if (p === 'custom') return;` at `:210` SKIPS it). Test:
  ```ts
  // assert that the time-command builder yields an entry whose id ends with 'custom'
  ```
- [ ] Run it (expect FAIL).
- [ ] Minimal impl — `CommandPalette.tsx`:
  - Stop skipping `custom` in the preset loop and instead push a dedicated "מעבר לטווח מותאם" action that switches to `preset:'custom'` keeping the current `filters.range` (so the Filters date inputs become editable) and navigates to a tab whose header exposes the date picker (e.g. keep current tab; the operator then edits from/to). Concretely, after the preset loop, add:
    ```tsx
    cmds.push({
      id: 'preset-custom',
      kind: 'preset',
      label: 'מעבר לטווח מותאם…',
      labelText: 'טווח מותאם',
      subtitle: 'בחר תאריכים בסרגל הסינון',
      icon: <CalendarDays size={15} />,
      search: 'custom range טווח מותאם תאריכים מ עד'.toLowerCase(),
      perform: () => { setFilters({ ...filters, preset: 'custom' }); close(); },
    });
    ```
    (`computePresetRange('custom', filters.range)` is the existing semantics; passing the current range keeps the inputs sane.)
  - Replace the NL stub block (`:608-615`). Since an AI NL slot is out of scope for WS6 and "Plan 2" never shipped, REMOVE the stubbed slot entirely (delete the `{query.length > 0 && (...יזמין ב-Plan 2...)}` block) so the palette no longer advertises a non-existent feature. (If the operator wants to keep a hint, replace with nothing — do not leave dead "coming soon" copy.)
- [ ] Run tests (expect PASS).
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` — palette section: add Payments + custom-range jump; remove any mention of the AI NL slot if documented + bump גרסה.
- [ ] Run full gate.
- [ ] Commit: `git add -A && git commit -m "feat(ux): palette custom-range jump; remove dead Plan-2 AI stub (ux-command-palette-actions)"`

---

### Feature: Explicit period-over-period comparison (gap `ux-period-compare`)
Impact: high · Effort: M · CAPI-safe: yes (all comparison ranges resolve to `data.rows` via mapping-aware `aggregate`) · Dependencies: builds on the filters/range state (independent of other WS6 features; do after the S-sized quick wins). UI element → MOCKUP FIRST.

Background (grounded): comparison is implicit-only — `Dashboard.tsx:375` computes `prevR = previousRange(filters.range)` once and the hero caption uses `comparisonLabelHebrew(filters.preset)` (`:1262`). `presets.ts:163` `previousRange` is fixed to the immediately-preceding equal-length window. The operator cannot pick "same month last year" (seasonality) or "prior 7d explicitly". We add an OPTIONAL `compareBaseline` to `Filters`, a resolver that maps a baseline choice to a concrete `DateRange`, and a baseline selector in `Filters.tsx`; the hero already accepts a `prevAgg`, so we feed it the resolved baseline instead of the hardwired `previousRange`. (Per-card / chart compare-overlay is a larger follow-up; this gap's core is "the operator can CHOOSE the comparison baseline" — we make the baseline selectable and flow it into the hero delta + caption. The chart compare-overlay is split into Task 12c, gated behind operator approval of the mockup.)

#### Task 11 — Mockup-first (operator approval) + types + resolver
- [ ] Build a static HTML mockup at `docs/superpowers/mockups/2026-06-04-ux-workflow/period-compare.html` showing: the Filters bar with a new "השווה מול" selector (options: תקופה קודמת · שבוע שעבר · חודש שעבר · אותו חודש אשתקד · אותם 7 ימים אשתקד · ללא השוואה) and the hero delta line re-captioned per choice. Both light AND dark, token-driven (copy the CSS vars block from an existing mockup in `docs/superpowers/mockups/2026-06-03-*`), RTL.
- [ ] Deliver to operator as an open link: `open docs/superpowers/mockups/2026-06-04-ux-workflow/period-compare.html`. WAIT for approval before code.
- [ ] Write failing test `dashboard-web/src/lib/__tests__/compareBaseline.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { resolveCompareRange, type CompareBaseline } from '@/lib/presets';

  const R = { from: '2026-05-08', to: '2026-05-14' }; // a 7-day window

  describe('resolveCompareRange', () => {
    it('prev-period = immediately preceding equal-length window', () => {
      expect(resolveCompareRange('prev_period', R)).toEqual({ from: '2026-05-01', to: '2026-05-07' });
    });
    it('prev-year = same calendar dates one year earlier', () => {
      expect(resolveCompareRange('prev_year', R)).toEqual({ from: '2025-05-08', to: '2025-05-14' });
    });
    it('prev-7d = the 7 days immediately before, regardless of range length', () => {
      const r = resolveCompareRange('prev_7d', { from: '2026-05-10', to: '2026-05-12' });
      expect(r).toEqual({ from: '2026-05-03', to: '2026-05-09' });
    });
    it('prev-month = same window shifted back one calendar month', () => {
      const r = resolveCompareRange('prev_month', { from: '2026-05-08', to: '2026-05-14' });
      expect(r).toEqual({ from: '2026-04-08', to: '2026-04-14' });
    });
    it('none = null (no comparison)', () => {
      expect(resolveCompareRange('none', R)).toBeNull();
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run src/lib/__tests__/compareBaseline.test.ts`
- [ ] Minimal impl — `dashboard-web/src/lib/types.ts`: add
  ```ts
  export type CompareBaseline =
    | 'prev_period' | 'prev_7d' | 'prev_month' | 'prev_year' | 'none';
  ```
  and extend `Filters`: `compareBaseline?: CompareBaseline;` (optional → all existing callers compile; absence means "prev_period", the current implicit behavior).
- [ ] Minimal impl — `dashboard-web/src/lib/presets.ts`: re-export `CompareBaseline` and add `resolveCompareRange`:
  ```ts
  import type { CompareBaseline } from './types';
  export type { CompareBaseline };

  /** Resolve an explicit comparison baseline to a concrete DateRange (or null
   *  for 'none'). All UTC-anchored to stay DST-immune (mirrors previousRange). */
  export function resolveCompareRange(baseline: CompareBaseline, range: DateRange): DateRange | null {
    if (baseline === 'none') return null;
    if (baseline === 'prev_period') return previousRange(range);
    if (baseline === 'prev_7d') {
      const prevTo = addDays(new Date(range.from + 'T00:00:00Z'), -1);
      const prevFrom = addDays(prevTo, -6);
      return { from: fmt(prevFrom), to: fmt(prevTo) };
    }
    if (baseline === 'prev_month') {
      const shift = (s: string) => {
        const d = new Date(s + 'T00:00:00Z');
        return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate())));
      };
      return { from: shift(range.from), to: shift(range.to) };
    }
    // prev_year
    const shiftY = (s: string) => {
      const d = new Date(s + 'T00:00:00Z');
      return fmt(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())));
    };
    return { from: shiftY(range.from), to: shiftY(range.to) };
  }

  /** Hebrew caption for an explicit baseline. */
  export const COMPARE_BASELINE_LABELS: Record<CompareBaseline, string> = {
    prev_period: 'מול התקופה הקודמת',
    prev_7d:     'מול 7 הימים הקודמים',
    prev_month:  'מול החודש הקודם',
    prev_year:   'מול אותה תקופה אשתקד',
    none:        'ללא השוואה',
  };
  ```
  (`addDays`/`fmt`/`previousRange` already exist in this file.)
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run src/lib/__tests__/compareBaseline.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): CompareBaseline type + resolveCompareRange + labels (ux-period-compare)"`

#### Task 12 — Baseline selector in Filters + wire hero delta to the chosen baseline
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/FiltersCompare.dom.test.tsx`: render `Filters` with `filters.compareBaseline='prev_year'`; assert the selector shows the prev-year option selected and that choosing "ללא השוואה" calls `onChange` with `compareBaseline:'none'`.
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/FiltersCompare.dom.test.tsx`
- [ ] Minimal impl — `Filters.tsx`: add an optional compare-baseline `<select>`-style control (use the existing pill/Button pattern in Filters; do NOT introduce a raw `<select>` if the codebase uses pill toggles — mirror the preset pills). Default-render it only on Home/Trends headers (pass a `showCompare?: boolean` prop, default false, so other Filters mounts are unaffected). On change, call `onChange({ ...filters, compareBaseline })`. Token-driven, RTL, light+dark; WCAG-AA labels.
- [ ] Minimal impl — `Dashboard.tsx`: replace the hardwired `previousRange(filters.range)` at `:375` (and the `prevRange` memo at `:820`) with the resolved baseline:
  ```ts
  import { resolveCompareRange, COMPARE_BASELINE_LABELS } from '@/lib/presets';
  const compareRange = resolveCompareRange(filters.compareBaseline ?? 'prev_period', filters.range);
  // in `filtered` memo: const prevR = compareRange ?? filters.range; const prev = compareRange ? filterRows(...) : [];
  // pass prevAgg only when compareRange != null; otherwise omit/zero so the hero hides the delta.
  ```
  And replace the hero `comparisonLabel={comparisonLabelHebrew(filters.preset)}` (`:1262`) with `COMPARE_BASELINE_LABELS[filters.compareBaseline ?? 'prev_period']` when a baseline is chosen (keep `comparisonLabelHebrew` for the default `prev_period` path so the today→"מול אתמול" nicety is preserved; choose the label that matches the resolved range).
- [ ] Run tests (expect PASS).
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (compare baseline UX) + `docs/ARCHITECTURE.md` (note `resolveCompareRange` + `Filters.compareBaseline`) + bump both versions.
- [ ] Run full gate.
- [ ] Commit: `git add -A && git commit -m "feat(ux): explicit period-over-period baseline selector wired to hero delta (ux-period-compare)"`

#### Task 12c — (GATED, optional) compare-series overlay on the Trends RoasChart
- [ ] Only if the operator approves the overlay in the Task 11 mockup: add a dashed second line to `RoasChart.tsx` for the resolved compare range (offset-aligned by day index), behind a `compareSeries?` prop. Write a DOM test asserting a second `<Line>` renders when `compareSeries` is provided. Implement minimally; commit `feat(ux): optional compare-series overlay on Trends chart (ux-period-compare)`. If not approved, SKIP and note in Self-Review.

---

### Feature: Saved views / favorites (gap `ux-saved-views`)
Impact: medium · Effort: M · CAPI-safe: yes · Dependencies: none (storage reuses cloudSync/dashboard-state). UI element → MOCKUP FIRST.

Background (grounded): state is URL-mirrored only (`urlState.ts`) + fixed preset list (`presets.ts`). `dashboard-state` already persists arbitrary allowlisted JSONB keys (`/api/dashboard-state` + `cloudSync.ts:STATE_KEYS`), and `cogsSettings.ts`/`useCogsSettings.ts` are the exact read/write/normalize + reactive-hook pattern to mirror. A saved view = `{ id, name, tab, store, preset, range?, sortKey?, sortDir? }`. We register ONE new synced key in BOTH `STATE_KEYS` (client) and `ALLOWED_STATE_KEYS` (server) — the parity guard (`stateKeysParity.test.ts`) ENFORCES this.

#### Task 13 — Mockup-first + savedViews storage module
- [ ] Build static mockup `docs/superpowers/mockups/2026-06-04-ux-workflow/saved-views.html`: a header dropdown listing saved views (apply on click), a "שמור תצוגה נוכחית" row with a name input, and a delete (✕) per row. Light+dark, token-driven, RTL. Deliver: `open docs/superpowers/mockups/2026-06-04-ux-workflow/saved-views.html`. WAIT for approval.
- [ ] Write failing test `dashboard-web/src/lib/__tests__/savedViews.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { readSavedViews, addSavedView, removeSavedView, type SavedView } from '@/lib/savedViews';

  beforeEach(() => window.localStorage.clear());

  const view = (over: Partial<SavedView> = {}): Omit<SavedView, 'id' | 'createdAt'> => ({
    name: 'zolplus · קמפיינים · 7 ימים',
    tab: 'campaigns', store: 'zolplus', preset: 'last_7_days',
    sortKey: 'roas', sortDir: 'desc', ...over,
  });

  describe('savedViews', () => {
    it('empty by default', () => expect(readSavedViews()).toEqual([]));
    it('add assigns an id + createdAt and persists', () => {
      const v = addSavedView(view());
      expect(v.id).toBeTruthy();
      expect(readSavedViews()).toHaveLength(1);
      expect(readSavedViews()[0].name).toContain('zolplus');
    });
    it('remove deletes by id', () => {
      const v = addSavedView(view());
      removeSavedView(v.id);
      expect(readSavedViews()).toEqual([]);
    });
    it('drops malformed persisted entries (corrupt localStorage) gracefully', () => {
      window.localStorage.setItem('roas-dashboard:saved-views', '{"not":"an array"}');
      expect(readSavedViews()).toEqual([]);
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/savedViews.test.ts`
- [ ] Minimal impl — create `dashboard-web/src/lib/savedViews.ts` (mirror `cogsSettings.ts` read/normalize + `annotations.ts` write+pushCloudKey+generateId pattern):
  ```ts
  import { pushCloudKey, type StateKey } from './cloudSync';
  import type { PresetKey, DateRange } from './types';
  import type { TabKey } from './urlState';

  export const SAVED_VIEWS_KEY: StateKey = 'roas-dashboard:saved-views';
  export const SAVED_VIEWS_EVENT = 'roas-saved-views-changed';

  export interface SavedView {
    id: string;
    name: string;
    tab: TabKey;
    store: string;        // 'All' or store name
    preset: PresetKey;
    range?: DateRange;    // only meaningful when preset === 'custom'
    sortKey?: string;
    sortDir?: 'asc' | 'desc';
    createdAt: number;
  }

  function genId(): string {
    return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  export function readSavedViews(): SavedView[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedView[]).filter(v => v && typeof v.id === 'string') : [];
    } catch { return []; }
  }

  function write(items: SavedView[]): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(items));
      window.dispatchEvent(new CustomEvent(SAVED_VIEWS_EVENT));
      pushCloudKey(SAVED_VIEWS_KEY, items);
    } catch { /* ignore */ }
  }

  export function addSavedView(input: Omit<SavedView, 'id' | 'createdAt'>): SavedView {
    const v: SavedView = { ...input, id: genId(), createdAt: Date.now() };
    write([...readSavedViews(), v]);
    return v;
  }

  export function removeSavedView(id: string): void {
    write(readSavedViews().filter(v => v.id !== id));
  }
  ```
- [ ] Register the new synced key in BOTH lists (parity guard will fail otherwise):
  - `dashboard-web/src/lib/cloudSync.ts` — add `'roas-dashboard:saved-views',` to `STATE_KEYS` (`:53-75`) AND add `'roas-dashboard:saved-views': 'roas-saved-views-changed',` to `CHANGE_EVENTS` (`:78-91`).
  - `dashboard-web/src/lib/dashboardStateKeys.ts` — add `'saved-views',` to `ALLOWED_STATE_KEYS`.
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/lib/__tests__/savedViews.test.ts && npx vitest run src/lib/__tests__/stateKeysParity.test.ts`
- [ ] Commit: `git add -A && git commit -m "feat(ux): savedViews storage + register synced state key (ux-saved-views)"`

#### Task 14 — `useSavedViews` hook + `<SavedViewsMenu>` + mount in header
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/SavedViewsMenu.dom.test.tsx`: render `SavedViewsMenu` with `current={{tab:'campaigns',store:'zolplus',preset:'last_7_days'}}`; assert "שמור תצוגה נוכחית" saves (list grows), clicking a saved row calls `onApply` with that view's `{tab,store,preset,range}`, and the ✕ removes it.
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/SavedViewsMenu.dom.test.tsx`
- [ ] Minimal impl — create `dashboard-web/src/lib/hooks/useSavedViews.ts` (mirror `useCogsSettings.ts`):
  ```ts
  'use client';
  import { useEffect, useState, useCallback } from 'react';
  import { readSavedViews, addSavedView, removeSavedView, SAVED_VIEWS_EVENT, type SavedView } from '@/lib/savedViews';

  export function useSavedViews() {
    const [views, setViews] = useState<SavedView[]>(() => readSavedViews());
    useEffect(() => {
      const reread = () => setViews(readSavedViews());
      window.addEventListener(SAVED_VIEWS_EVENT, reread);
      window.addEventListener('storage', reread);
      return () => { window.removeEventListener(SAVED_VIEWS_EVENT, reread); window.removeEventListener('storage', reread); };
    }, []);
    const add = useCallback((v: Parameters<typeof addSavedView>[0]) => addSavedView(v), []);
    const remove = useCallback((id: string) => removeSavedView(id), []);
    return { views, add, remove };
  }
  ```
- [ ] Minimal impl — create `dashboard-web/src/components/SavedViewsMenu.tsx`: a `Button`-triggered dropdown (reuse the dropdown/popover primitive used by `CampaignsColumnsMenu`; do NOT hand-roll a fixed overlay over a Sheet — follow the Radix nesting rule). Props: `current: { tab; store; preset; range }`, `onApply: (v: SavedView) => void`. Lists `views`, each clickable (calls `onApply`) with a ✕ (calls `remove`); a "שמור תצוגה נוכחית" row with a name `<Input>` (default name auto-built from `current` via `rangeLabelHebrew` + store + tab label) + a save `Button`. Token-driven, RTL, light+dark, AA labels; numbers (if any) through `Money`/tabular-nums (none expected).
- [ ] Minimal impl — `Dashboard.tsx`: mount `<SavedViewsMenu current={{ tab: activeTab, store: filters.store, preset: filters.preset, range: filters.range }} onApply={(v) => { handleTabChange(v.tab); setFilters({ preset: v.preset, range: v.range ?? computePresetRange(v.preset), store: v.store, compareBaseline: filters.compareBaseline }); }} />` in the header strip (next to the CommandPalette trigger). Applying a view sets both tab + global filters; URL sync (`syncUrl`) persists it automatically.
- [ ] Run tests (expect PASS).
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` ("תצוגות שמורות": save/apply/delete, synced across devices) + `docs/ARCHITECTURE.md` (new `saved-views` synced key + module) + bump versions.
- [ ] Run full gate.
- [ ] Commit: `git add -A && git commit -m "feat(ux): SavedViewsMenu + useSavedViews hook, device-synced (ux-saved-views)"`

---

### Feature: Surface timeline annotations on the Trends chart + sync across devices (gap `ux-annotations-on-trends`)
Impact: medium · Effort: M · CAPI-safe: yes · Dependencies: none.

Background (grounded): annotations ALREADY exist (`lib/annotations.ts`), ARE device-synced (`'roas-dashboard:annotations'` is in `cloudSync.ts:STATE_KEYS:56`, in `ALLOWED_STATE_KEYS`, and `writeAnnotations` calls `pushCloudKey`), and ARE consumed by the Home V4 `RoasTargetChart` (pins built in `Dashboard.tsx:1106-1128` via `annotationsInScope` → `chartProp.pins`). They are NOT drawn on the dedicated Trends chart: `AnalysisTrendsTab.tsx:56` renders `<RoasChart … rows={filtered.cur} />` and `RoasChart.tsx` has NO annotation overlay (only the ROAS=3 `ReferenceLine` at `:108`). So the remaining work is purely: draw annotation anchor lines on `RoasChart`. (The "sync across devices" half of the gap is ALREADY satisfied — verify with a guard test rather than re-implement.)

#### Task 15 — Guard test: annotations are a first-class synced key (verify, no new code)
- [ ] Write test `dashboard-web/src/lib/__tests__/annotationsSync.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { STATE_KEYS } from '@/lib/cloudSync';
  import { ALLOWED_STATE_KEYS } from '@/lib/dashboardStateKeys';

  describe('annotations are device-synced', () => {
    it('annotations key is in both client STATE_KEYS and server ALLOWED_STATE_KEYS', () => {
      expect(STATE_KEYS).toContain('roas-dashboard:annotations');
      expect(ALLOWED_STATE_KEYS).toContain('annotations');
    });
  });
  ```
- [ ] Run it (expect PASS immediately — documents the invariant): `cd dashboard-web && npx vitest run src/lib/__tests__/annotationsSync.test.ts`
- [ ] Commit: `git add -A && git commit -m "test(ux): assert annotations are a first-class device-synced key (ux-annotations-on-trends)"`

#### Task 16 — Draw annotation ReferenceLines on RoasChart
- [ ] (Mockup gate) Annotation overlay on a line chart is a non-trivial visual; build `docs/superpowers/mockups/2026-06-04-ux-workflow/trends-annotations.html` showing dashed vertical anchor lines at event dates with a small emoji+label tag, light+dark, token-driven, AA-legible label scrim. Deliver: `open docs/superpowers/mockups/2026-06-04-ux-workflow/trends-annotations.html`. WAIT for approval (kind→color tokens already exist: `--annotation-*` in `annotations.ts:61-70`).
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/RoasChartAnnotations.dom.test.tsx`: render `RoasChart` with `data` covering `2026-05-01..2026-05-05`, `stores=['uzoshop']`, `rows=[...]`, and `annotations=[{date:'2026-05-03', kind:'launch', title:'השקה', ...}]`; assert an SVG element carrying the annotation's accessible label / `data-annotation-date="2026-05-03"` is rendered. (Recharts `ReferenceLine` renders deterministically; assert on a stable test id/attribute we add.)
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/RoasChartAnnotations.dom.test.tsx`
- [ ] Minimal impl — `RoasChart.tsx`:
  - Extend `Props` with `annotations?: Annotation[]` (import the `Annotation` type + `ANNOTATION_KIND_COLOR`/`ANNOTATION_KIND_EMOJI` from `@/lib/annotations`).
  - Map the `chartData` to know each date's x-category (the `dateLabel` `DD/MM`). For each annotation whose `date` is within `data`, render a `<ReferenceLine x={dateLabelForDate} stroke={ANNOTATION_KIND_COLOR[a.kind]} strokeDasharray="3 3" strokeWidth={1.5}>` with a small `<Label>` (emoji + short title) positioned at top, AA-legible (label on a neutral scrim — use the existing chart label tokens, never the band color for text). Add `data-annotation-date={a.date}` for the test hook. Use `--chart-*`/`--annotation-*` tokens only (the `no-cross-palette-import` rule allows `--annotation-*`? — annotations.ts already exports them as CSS vars; if the chart-palette guard blocks direct `--annotation-*` in a chart file, route them through `chartColors.ts` like `CHART_WARNING_COLOR` at `:18,197` — add an `annotationColor(kind)` helper there). 
  - Guard: skip annotations whose date isn't in the visible `data` window (no off-canvas lines).
- [ ] Minimal impl — `AnalysisTrendsTab.tsx`: read annotations in scope and pass them down. Add:
  ```tsx
  import { readAnnotations, annotationsInScope } from '@/lib/annotations';
  // inside the component (with a useEffect+state mirroring Dashboard.tsx:1113-1119, or lift via a small useAnnotations hook):
  const annotations = annotationsInScope(readAnnotations(), filters.range, filters.store);
  // ...
  <RoasChart data={filtered.series} stores={filtered.visibleStores} rows={filtered.cur} annotations={annotations} bare />
  ```
  Subscribe to `'roas-annotations-changed'` so a new annotation appears without refresh (mirror `Dashboard.tsx:1114-1119`). Consider extracting a `useAnnotations(range, store)` hook into `lib/hooks/` to DRY the Dashboard + Trends subscriptions; if extracted, refactor `Dashboard.tsx:1113-1128` to use it (keep behavior identical, covered by existing pins behavior — add no regression).
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/RoasChartAnnotations.dom.test.tsx`
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (annotations now appear as anchor lines on the מגמות chart, not just Home) + `docs/ARCHITECTURE.md` if a `useAnnotations` hook/`chartColors.annotationColor` is added + bump versions.
- [ ] Run full gate (include `npm run lint` to confirm the chart-palette guard stays green).
- [ ] Commit: `git add -A && git commit -m "feat(ux): annotation anchor lines on the Trends ROAS chart (ux-annotations-on-trends)"`

---

### Feature: Cross-store comparison grid (gap `ux-store-compare-grid`)
Impact: medium · Effort: M · CAPI-safe: yes (mapping-aware `aggregateByStore`) · Dependencies: none. UI element → MOCKUP FIRST.

Background (grounded): per-store data renders as banded cards/deck (`home/PerStoreRow.tsx`); the global store filter is single-select (`Filters.tsx`). There is no view lining up uzoshop / Zol Plus / 360usmile as comparable COLUMNS of the same metric rows. `analytics.ts:311 aggregateByStore(rows, range)` ALREADY returns the exact `StoreAgg[]` shape (sorted by ROAS desc) — Dashboard already computes `storeAggs` (`Dashboard.tsx:388`). Order counts come from `ordersData` (already fetched, `Dashboard.tsx:215`) and NC share from the same NC-ROAS path the Home cards use. We add a presentational grid component fed by these existing aggregates — NO new data fetch.

#### Task 17 — Mockup-first + StoreCompareGrid component
- [ ] Build static mockup `docs/superpowers/mockups/2026-06-04-ux-workflow/store-compare.html`: metric rows down the left (ROAS · הוצאה · הכנסה · רווח נטו · AOV · הזמנות · נתח לקוחות חדשים), store columns across (uzoshop · Zol Plus · 360usmile), best-in-row highlighted (token accent, not hue-on-hue), all numbers tabular-nums. Light+dark, token-driven, RTL, AA. Deliver: `open docs/superpowers/mockups/2026-06-04-ux-workflow/store-compare.html`. WAIT for approval.
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/StoreCompareGrid.dom.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { StoreCompareGrid } from '@/components/StoreCompareGrid';
  import type { StoreAgg } from '@/lib/analytics';

  const agg = (store: string, over: Partial<StoreAgg>): StoreAgg => ({
    store, revenue: 1000, grossRevenue: 1000, spend: 400, fbSpend: 400, gaSpend: 0, ttSpend: 0,
    roas: 2.5, grossProfit: 600, cogs: 250, netProfit: 350, transactionFees: 0, fixedCosts: 0,
    salaries: 0, storeCount: 1, daysCovered: 7, trueNetProfit: 300, trueMargin: 0.3, rowCount: 7,
    ...over,
  } as StoreAgg);

  describe('StoreCompareGrid', () => {
    const data = [agg('uzoshop', { roas: 3.1 }), agg('Zol Plus', { roas: 2.0 }), agg('360usmile', { roas: 2.6 })];
    it('renders one column per store', () => {
      render(<StoreCompareGrid storeAggs={data} ordersByStore={{}} />);
      expect(screen.getByText('uzoshop')).toBeInTheDocument();
      expect(screen.getByText('Zol Plus')).toBeInTheDocument();
      expect(screen.getByText('360usmile')).toBeInTheDocument();
    });
    it('renders a ROAS metric row', () => {
      render(<StoreCompareGrid storeAggs={data} ordersByStore={{}} />);
      expect(screen.getByText('ROAS')).toBeInTheDocument();
    });
    it('marks the best store in the ROAS row (data-best on the winning cell)', () => {
      const { container } = render(<StoreCompareGrid storeAggs={data} ordersByStore={{}} />);
      const best = container.querySelector('[data-metric="roas"][data-best="true"]');
      expect(best).not.toBeNull();
    });
  });
  ```
- [ ] Run it (expect FAIL): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/StoreCompareGrid.dom.test.tsx`
- [ ] Minimal impl — create `dashboard-web/src/components/StoreCompareGrid.tsx`:
  - Props: `storeAggs: StoreAgg[]`, `ordersByStore: Record<string, number>` (the same per-store order-count map Dashboard already derives at `:405-423`), optional `ncShareByStore?: Record<string, number>`.
  - Use the `TableBase` primitive (satisfies `no-raw-table-in-components`) with stores as columns. Metric rows: ROAS (formatNumber + `RoasBadge` tone), הוצאה / הכנסה / רווח נטו (via `Money`), AOV (`Money`, = revenue/orders), הזמנות (formatNumber 0), נתח לקוחות חדשים (% — only when `ncShareByStore` provided).
  - For "higher is better" metrics (ROAS, revenue, net, AOV, NC share) mark the max cell `data-best="true"` + a token accent emphasis class; for הוצאה (spend) lower-is-not-necessarily-better → do NOT mark a "best" (or mark lowest only if the operator's mockup asks). Add `data-metric="<key>"` per cell for the test hook.
  - Token-driven only (no hex), RTL/logical classes, light+dark, every number through `Money`/tabular-nums (never clipped). AA: best-cell emphasis via accent ring/weight, not a band-hue text color.
- [ ] Run tests (expect PASS): `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/StoreCompareGrid.dom.test.tsx`
- [ ] Commit: `git add -A && git commit -m "feat(ux): StoreCompareGrid (3 stores as comparable columns) (ux-store-compare-grid)"`

#### Task 18 — Mount StoreCompareGrid (Home, only when store filter = All)
- [ ] Write failing DOM test asserting the grid mounts on the Home tab when `filters.store === 'All'` and there are ≥2 stores, and is hidden when a single store is selected. (Render the Home tab content path with a mocked `DashboardData`; or assert a small `shouldShowStoreCompare(filters, stores)` pure predicate — PREFER the predicate to keep the test cheap, then use it at the mount site.) Test the predicate:
  ```ts
  import { shouldShowStoreCompare } from '@/components/StoreCompareGrid';
  it('shows only when All-stores and >=2 stores', () => {
    expect(shouldShowStoreCompare('All', ['a','b'])).toBe(true);
    expect(shouldShowStoreCompare('a', ['a','b'])).toBe(false);
    expect(shouldShowStoreCompare('All', ['a'])).toBe(false);
  });
  ```
- [ ] Run it (expect FAIL): add `shouldShowStoreCompare`.
- [ ] Minimal impl — export `shouldShowStoreCompare(store: string, stores: string[]) => store === 'All' && stores.length >= 2` from `StoreCompareGrid.tsx`; in `Dashboard.tsx` HomeTab render path, mount `<StoreCompareGrid storeAggs={filtered.storeAggs} ordersByStore={ordersByStore} ncShareByStore={...} />` between `<PerStoreRow>` and the bottom row, guarded by `shouldShowStoreCompare(filters.store, data.stores)`. (Reuse the per-store order map already computed near `:405-423`; reuse the NC-share path the Home cards use if readily available, else omit the NC row in v1.)
- [ ] Run tests (expect PASS).
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` ("השוואת חנויות" grid on Home when "כל החנויות") + bump גרסה. (No ARCHITECTURE change unless `aggregateByStore` is touched — it isn't.)
- [ ] Run full gate.
- [ ] Commit: `git add -A && git commit -m "feat(ux): mount StoreCompareGrid on Home (All-stores) (ux-store-compare-grid)"`

---

## Self-Review

Spec coverage — every listed gap id has its own `### Feature` with bite-sized TDD tasks (failing test → exact run cmd → real impl → pass → commit):
- `ux-home-default-today` → Tasks 1–2 (DEFAULT_PRESET constant + Dashboard init + urlState omission + deep-link honor). OPERATOR HARD REQUIREMENT, Wave-1 quick win, sequenced FIRST.
- `ux-csv-export` → Tasks 3–5 (toCsv + ExportCsvButton + wire Detail/Campaigns/Products).
- `ux-table-search` → Tasks 6–8 (matchesNameQuery + Campaigns + Products/Ads search).
- `ux-command-palette-actions` → Tasks 9–10 (deep-link drill via existing `drillToCampaigns(campaign)`, Payments tab, custom-range jump, remove Plan-2 stub).
- `ux-period-compare` → Tasks 11–12 (+ gated 12c) (CompareBaseline + resolveCompareRange + Filters selector + hero wiring).
- `ux-saved-views` → Tasks 13–14 (savedViews storage + synced-key registration + hook + menu + mount).
- `ux-annotations-on-trends` → Tasks 15–16 (sync-already-satisfied guard + ReferenceLine overlay on RoasChart + Trends wiring).
- `ux-store-compare-grid` → Tasks 17–18 (StoreCompareGrid + Home mount predicate).

Placeholder scan — no "TODO"/"similar to Task N"/pseudocode left as impl: every impl step shows real code or names the exact real file + line region + existing function to mirror (`cogsSettings.ts`, `annotations.ts`, `AiReportButton.handleDownload`, `drillToCampaigns`, `aggregateByStore`, `previousRange`). The ONE place that says "if no existing harness, fall back" (Task 7) gives a concrete fallback (extract a tested selector) — not a skip.

Type consistency — new types (`CompareBaseline`, `SavedView`, `CsvCell`, `CsvPayload`, `AllowedStateKey`/`StateKey` additions) are declared in `types.ts`/their module and threaded through real call sites. `Filters.compareBaseline` is OPTIONAL so all existing `Filters` consumers compile unchanged; `RoasChart.annotations` and `Filters.showCompare` are optional for the same reason. The new `saved-views` key is added to BOTH `STATE_KEYS` and `ALLOWED_STATE_KEYS` — the existing `stateKeysParity.test.ts` enforces this (a miss fails CI), and Task 13 runs it explicitly.

Constraints honored — CAPI-safe/READ-ONLY throughout (no pixel/CAPI writes; CSV serializes already-rendered mapping-aware rows; all comparison/store-grid numbers come from `aggregate`/`aggregateByStore` over `data.rows`, never raw account totals). Every non-trivial UI feature (period-compare, saved-views, annotation overlay, store-compare grid) has a mockup-first task delivered as an `open <abs-path>` link with an explicit WAIT-for-approval gate. New UI uses shared primitives (`Button`/`Input`/`Card`/`TableBase`/`Money`/`HelpTooltip`), token-only colors, logical/RTL classes, light+dark, AA, and runs `npm run lint` so the design-system guards (`no-physical-direction`, `no-native-title-tooltip`, `no-raw-*`, `no-hex-color`, `no-cross-palette-import`, green-ratchet) stay green. Docs-currency gate handled per task (User Manual for UI; ARCHITECTURE for lib/state-key changes) with version bumps.

## Open questions for the operator
1. Default-today (ux-home-default-today): confirm the default should be the SINGLE current IL day (`computePresetRange('today')` → from==to), not "today incl. partial = this_week/last_7d". Plan assumes single-day.
2. Period-compare (ux-period-compare): is the baseline selector wanted on BOTH Home and Trends headers, or Home only? And do you want the compare-series OVERLAY on the Trends line chart now (Task 12c) or defer it? Plan defers 12c behind your mockup approval.
3. Store-compare grid placement: on the Home tab between PerStoreRow and the bottom row (only when "כל החנויות"), or as its own surface? And should the "נתח לקוחות חדשים" (NC share) row ship in v1 or be a follow-up? Plan ships it only if the NC-share-by-store map is readily available, else omits in v1.
4. Saved views: auto-naming default — is `"<store> · <tab> · <range>"` acceptable, and should applying a view also restore per-tab sort (`sortKey`/`sortDir`) for the Campaigns tab, or only the global tab+store+range? Plan stores sort but only wires global tab+store+range on apply (sort restore is a small follow-up if wanted).
5. CSV export columns: confirm the proposed Hebrew header sets per table (Detail/Campaigns/Products) match what you'd paste into Excel; want the EXACT visible columns (respecting hidden-column prefs on Campaigns) or the full canonical set regardless of column-visibility? Plan exports the canonical set.
6. Command palette: OK to fully REMOVE the "שאלת AI … יזמין ב-Plan 2" stub slot (no AI NL feature is in scope), rather than leave a "coming soon" hint? Plan removes it.
7. Annotations on Trends: the `--annotation-*` color tokens are reused for the anchor lines — if the chart-palette guard (`no-cross-palette-import`) blocks importing them into a chart file, the plan routes them through a new `chartColors.annotationColor(kind)`. Confirm you're fine adding that helper.
