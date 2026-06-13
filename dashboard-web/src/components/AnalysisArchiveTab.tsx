'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays } from 'lucide-react';
import { YearSelector } from '@/components/YearSelector';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthlyTables, type Mode } from '@/components/MonthlyTables';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SectionIntro } from '@/components/SectionIntro';
import { PageScope } from '@/components/ui/PageScope';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { StateBlock } from '@/components/ui/StateBlock';
import { synthesizeArchive } from '@/lib/synthesis/archive';
import { buildDateRangeKey } from '@/lib/dateRange';
import { fetchJsonStrict } from '@/lib/fetchJson';
import type { DashboardData } from '@/lib/types';

type Props = {
  stores: DashboardData['stores'];
  /**
   * Global store filter (filters.store from Dashboard). When set to a
   * specific store, the archive scopes both the page synthesis and the
   * monthly tables to that store. 'All' (or undefined) preserves the
   * legacy all-stores behavior. Per [[home-visual-rules]] the global
   * filter applies to most pages — Archive was previously ignoring it.
   */
  globalStore?: string;
};

// ROAS-band legend chips. COLORS + THRESHOLDS mirror the operator-locked
// classification in `bandForRoas` (lib/roasBands.ts — the single source of
// truth): red < 2.0, orange 2.0–2.69, green 2.7–3.0, blue > 3.0. Rendered via
// the AA-safe shared `band-chip chip-{band}` recipe (globals.css) — never a
// text colour pulled straight from the band hue. This is a STATIC legend (not a
// classifier), so it does not introduce a parallel band map. Threshold labels
// are LTR numerics → isolated in <bdi dir="ltr"> for the RTL surface.
const ROAS_BAND_LEGEND = [
  { band: 'red', label: '< 2' },
  { band: 'orange', label: '2–2.7' },
  { band: 'green', label: '2.7–3' },
  { band: 'blue', label: '> 3' },
] as const;

// Mode-toggle options for the lifted controls row (kept in lock-step with the
// MonthlyTables internal toolbar). Values match the `Mode` union.
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'per-store', label: 'לפי חנות' },
  { value: 'summary', label: 'סיכום כללי' },
];

// Match MonthlyTables' fetcher so the SWR key is shared (no duplicate
// network request — same `/api/data?from=...&to=...` URL is hit by both
// children of AnalysisArchiveTab).
// P1-4 (2026-06-10 state-honesty sweep) — fetchJsonStrict also throws on the
// /api/data 200-with-error degraded body (WR-06), matching MonthlyTables'
// fetcher so the shared key keeps one behavior.
const fetcher = (url: string): Promise<DashboardData> =>
  fetchJsonStrict<DashboardData>(url);

export function AnalysisArchiveTab({ stores, globalStore }: Props) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);

  // Lifted from MonthlyTables so the mode toggle (לפי חנות / סיכום כללי) +
  // store picker sit on the SAME row as year/month (operator request
  // 2026-06-01). MonthlyTables receives these as CONTROLLED props and
  // suppresses its own internal toolbar. Seeding/sync mirrors MonthlyTables'
  // former internal logic exactly so behavior is unchanged.
  const [mode, setMode] = useState<Mode>('per-store');
  const [storeFilter, setStoreFilter] = useState<string>(
    globalStore && globalStore !== 'All' && stores.includes(globalStore)
      ? globalStore
      : stores[0] || 'All',
  );
  // Keep the store picker in sync when the operator changes the global filter
  // to a specific store — but still allow a local override afterwards (same
  // contract MonthlyTables had).
  useEffect(() => {
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) {
      setStoreFilter(globalStore);
    }
  }, [globalStore, stores]);

  // Share the SWR key with MonthlyTables so the year-wide fetch is
  // cached once and the synthesiser reads the same row set the tables
  // render. Without the shared key the synthesiser would fire its own
  // request and could disagree on the "strongest month" when the
  // network responses returned at slightly different times.
  const historyRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  // P1-4 — read `error` too: on a failed year fetch the synthesiser must NOT
  // run over [] rows (it would emit a fake "weak year" verdict). The visible
  // red error line itself renders in the MonthlyTables child (same SWR key →
  // same error), so here we only suppress the synthesis.
  const { data, error } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', historyRange),
    fetcher,
    { revalidateOnFocus: false },
  );

  // Horizon re-skin (W8): the archive's own year-wide SWR is unsettled when
  // neither `data` nor `error` has arrived. Until then the synthesiser would
  // run over `[]` rows (a false "weak year" verdict) and the MonthlyTables
  // child would paint empty/zero tables — i.e. a LOADING surface masquerading
  // as a settled EMPTY one. We render the canonical table skeleton in that
  // window only. Note: this is loading≠error≠empty:
  //   • loading (!data && !error) → skeleton (below)
  //   • error  (error truthy)     → existing error path: synthesis suppressed
  //     via `!error`, MonthlyTables surfaces the shared-key red error line
  //   • loaded (data truthy)      → synthesis + scope + controls + tables
  const isLoading = !data && !error;

  // Apply the global store filter to the synthesiser's input AND to the
  // visible scope label. The MonthlyTables child gets globalStore directly
  // and handles its own per-store filtering. 'All' (undefined or 'All')
  // preserves the all-stores behavior.
  const isStoreScoped =
    !!globalStore && globalStore !== 'All' && stores.includes(globalStore);
  const scopedRows = isStoreScoped
    ? (data?.rows ?? []).filter(r => r.storeName === globalStore)
    : (data?.rows ?? []);
  const archiveSynthesis = synthesizeArchive({
    rows: scopedRows,
    year,
  });

  return (
    // animate-fade-in-up restores the mount transition the Radix TabsContent
    // used to provide (now a top-level tab) and matches HomeTab / PnLTab.
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title={isStoreScoped ? `טבלאות חודשיות — ${globalStore}` : 'טבלאות חודשיות'}
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע לפי הבנדים שלהלן. יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      {/* ROAS-band legend — replaces the former prose thresholds. Each chip uses
          the AA-safe shared band-chip recipe; threshold ranges are LTR numerics
          isolated in <bdi>. Mirrors bandForRoas (the locked source of truth). */}
      <div className="flex flex-wrap items-center gap-2" aria-label="מקרא בנדים של ROAS">
        <span className="text-xs text-ink-muted">מקרא ROAS:</span>
        {ROAS_BAND_LEGEND.map(({ band, label }) => (
          <span key={band} className={`band-chip chip-${band}`}>
            <bdi dir="ltr">{label}</bdi>
          </span>
        ))}
      </div>
      {/* Horizon re-skin (W8): while the year-wide SWR is unsettled, show the
          canonical table skeleton in place of the (otherwise zero/empty)
          synthesis + scope + controls + tables, so loading never reads as a
          settled empty archive. Once data OR error arrives, the real surfaces
          below render. */}
      {isLoading && (
        <div className="p-1">
          <StateBlock mode="skeleton" shape="table" rows={8} message="טוען טבלאות חודשיות…" />
        </div>
      )}
      {!isLoading && (
      <>
      <PageScope
        store={isStoreScoped ? globalStore! : 'כל החנויות'}
        rangeLabel={month != null ? `${month}/${year}` : `${year}`}
        currency="CAD"
      />
      {/* P1-4 — suppress the synthesis verdict when the year fetch failed:
          synthesizing over [] rows would read as a confident (and false)
          business verdict. The MonthlyTables child below surfaces the red
          error line for the same shared SWR key. */}
      {!error && (
        <PageSynthesis
          text={archiveSynthesis.text}
          anchorMetric={archiveSynthesis.anchorMetric}
          confidence={archiveSynthesis.confidence}
        />
      )}
      {/* All FOUR archive controls on a SINGLE aligned row (operator request
          2026-06-01): year · month · mode-toggle · store-picker. Each is
          constrained to a fixed width so they don't span the full screen.
          NativeSelect's own wrapper is `w-full`, so the width cap lives on
          these containers; still ≥36px tall + tappable on mobile. The mode
          toggle + store picker are the SAME markup MonthlyTables uses, lifted
          here and wired to MonthlyTables via controlled props (its internal
          toolbar is suppressed). items-end aligns every control to a shared
          baseline; flex-wrap keeps the row orderly on narrow screens. */}
      <div className="flex items-end gap-3 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">שנה</span>
          <div className="w-28">
            <YearSelector value={year} onChange={setYear} />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">חודש</span>
          <div className="w-40">
            <MonthSelector value={month} onChange={setMonth} />
          </div>
        </label>
        {/* div (not label): the toggle is a role="tablist" of buttons, not a
            single form control, so a <label> wrapper would mis-associate its
            caption text with the first tab's accessible name. */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">תצוגה</span>
          <SegmentedControl
            aria-label="תצוגה"
            options={MODE_OPTIONS}
            value={mode}
            onChange={v => setMode(v as Mode)}
            size="sm"
          />
        </div>
        {mode === 'per-store' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">חנות</span>
            <div className="w-40">
              <NativeSelect
                aria-label="חנות"
                value={storeFilter}
                onChange={e => setStoreFilter(e.target.value)}
                className="font-medium"
              >
                {stores.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}
      </div>
      <MonthlyTables
        stores={stores}
        globalStore={globalStore}
        year={year}
        month={month}
        mode={mode}
        onModeChange={setMode}
        storeFilter={storeFilter}
        onStoreFilterChange={setStoreFilter}
      />
      </>
      )}
    </div>
  );
}
