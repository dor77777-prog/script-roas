'use client';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Heading } from '@/components/ui/Typography';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  TableBase, TableHead, TableRow, TableHeaderCell, TableCell,
} from '@/components/ui/TableBase';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import {
  DEFAULT_COGS_PCT, effectiveCogsPct, applyPctToScope,
  type ApplyScope, type CogsScopeSettings, type CogsSettings as TCogs,
} from '@/lib/cogsSettings';

type ScopeKind = 'current' | 'specific' | 'all-previous' | 'everything';

export function CogsSettings({ storeNames, currentMonth, monthsInData }: {
  storeNames: string[]; currentMonth: string; monthsInData: string[];
}) {
  const [settings, update] = useCogsSettings();
  const [mode, setMode] = useState<TCogs['mode']>(settings.mode);
  const [businessPct, setBusinessPct] = useState<string>(String(settings.business.default ?? DEFAULT_COGS_PCT));
  const [storePct, setStorePct] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const s of storeNames) o[s] = String(settings.perStore[s]?.default ?? DEFAULT_COGS_PCT);
    return o;
  });
  const [scopeKind, setScopeKind] = useState<ScopeKind>('current');
  const [specificMonth, setSpecificMonth] = useState<string>(currentMonth);
  // The per-month timeline is collapsed by default — it's a reference/audit
  // view, not something the operator needs open every time the COGS panel
  // renders. Operators expand it on demand.
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Fixed 18-month lookback ending at currentMonth, UNIONed with the months
  // actually present in the loaded range (monthsInData) and every explicit
  // byMonth key across the active scope(s). This makes the timeline, the
  // specific-month picker, and "all-previous" cover history independent of the
  // dashboard's current filter range (FIX 2026-06-02).
  const months = useMemo(() => {
    const set = new Set<string>([...lastNMonths(currentMonth, 18), ...monthsInData, currentMonth]);
    // Pull in any edited month even if it falls outside the 18-month window.
    if (mode === 'per-store') {
      for (const s of storeNames) for (const m of Object.keys(settings.perStore[s]?.byMonth ?? {})) set.add(m);
    } else {
      for (const m of Object.keys(settings.business.byMonth)) set.add(m);
    }
    return Array.from(set).sort().reverse();
  }, [monthsInData, currentMonth, mode, storeNames, settings]);

  /** Is `m` explicitly edited for the active mode (has a byMonth entry)? */
  const isEdited = (m: string): boolean =>
    mode === 'per-store'
      ? storeNames.some((s) => settings.perStore[s]?.byMonth[m] !== undefined)
      : settings.business.byMonth[m] !== undefined;

  const buildApply = (): ApplyScope => {
    switch (scopeKind) {
      case 'current': return { kind: 'current', currentMonth };
      case 'specific': return { kind: 'specific', month: specificMonth };
      case 'all-previous': return { kind: 'all-previous', currentMonth };
      case 'everything': return { kind: 'everything' };
    }
  };

  const onApply = () => {
    const apply = buildApply();
    if (mode === 'business') {
      const pct = clampPct(businessPct);
      const next: TCogs = { ...settings, mode, business: applyPctToScope(settings.business, pct, apply, months) };
      update(next);
    } else {
      const perStore = { ...settings.perStore };
      for (const s of storeNames) {
        const scope: CogsScopeSettings = perStore[s] ?? { default: DEFAULT_COGS_PCT, byMonth: {} };
        perStore[s] = applyPctToScope(scope, clampPct(storePct[s]), apply, months);
      }
      update({ ...settings, mode, perStore });
    }
  };

  // Mode toggle persists immediately (it's a global switch).
  const switchMode = (m: TCogs['mode']) => { setMode(m); update({ ...settings, mode: m }); };

  return (
    <Card className="space-y-4">
      <Heading level="panel">הוצאות מלאי (COGS)</Heading>

      {/* mode */}
      <div>
        <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1.5">מצב (גלובלי)</div>
        <SegmentedControl
          role="radiogroup"
          size="sm"
          aria-label="מצב COGS (גלובלי)"
          value={mode}
          onChange={(v) => switchMode(v as TCogs['mode'])}
          options={[
            { value: 'business', label: 'רמת עסק', testId: 'cogs-mode-business' },
            { value: 'per-store', label: 'רמת חנות', testId: 'cogs-mode-per-store' },
          ]}
        />
      </div>

      {/* % inputs */}
      <div className="space-y-2">
        {mode === 'business' ? (
          <PctField label="כל העסק" testid="cogs-business-input" value={businessPct} onChange={setBusinessPct} />
        ) : (
          storeNames.map((s) => (
            <PctField key={s} label={s} testid={`cogs-store-input-${s}`} value={storePct[s] ?? ''} onChange={(v) => setStorePct((p) => ({ ...p, [s]: v }))} />
          ))
        )}
      </div>

      {/* apply-scope */}
      <fieldset className="space-y-1.5">
        <legend className="text-2xs uppercase tracking-wide text-ink-muted mb-1">החל על</legend>
        <Radio name="cogs-scope" testid="cogs-scope-current" checked={scopeKind === 'current'} onChange={() => setScopeKind('current')} label={`החודש הנוכחי (${currentMonth})`} />
        <Radio name="cogs-scope" testid="cogs-scope-specific" checked={scopeKind === 'specific'} onChange={() => setScopeKind('specific')} label="חודש ספציפי" />
        {scopeKind === 'specific' && (
          <div className="ms-6">
            <NativeSelect data-testid="cogs-month" value={specificMonth} onChange={(e) => setSpecificMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </div>
        )}
        <Radio name="cogs-scope" testid="cogs-scope-all-previous" checked={scopeKind === 'all-previous'} onChange={() => setScopeKind('all-previous')} label="כל החודשים הקודמים" />
        <Radio name="cogs-scope" testid="cogs-scope-everything" checked={scopeKind === 'everything'} onChange={() => setScopeKind('everything')} label="הכל — קודמים + נוכחי + עתידיים" />
      </fieldset>

      <Button type="button" variant="primary" data-testid="cogs-apply" onClick={onApply} className="w-full">החל שינוי</Button>

      <p className="text-2xs text-ink-muted leading-relaxed">
        ברירת מחדל {DEFAULT_COGS_PCT}% לכל חודש שלא נערך. השינוי רטרואקטיבי ומיידי בכל הדשבורד. מסונכרן לענן.
      </p>

      {/* timeline — collapsible (collapsed by default) */}
      <div className="pt-1">
        <Button
          type="button"
          variant="ghost"
          data-testid="cogs-timeline-toggle"
          aria-expanded={timelineOpen}
          aria-controls="cogs-timeline-region"
          onClick={() => setTimelineOpen((v) => !v)}
          className="gap-1 h-auto px-2 py-1 text-[11px] sm:text-xs font-medium text-ink-secondary hover:text-ink"
        >
          {timelineOpen ? 'הסתר טבלת חודשים' : 'הצג טבלת חודשים'}
          {timelineOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </Button>
        {timelineOpen && (
          <div
            id="cogs-timeline-region"
            data-testid="cogs-timeline"
            className="mt-2 overflow-auto animate-fade-in"
          >
            <TableBase density="compact" className="text-xs">
          <TableHead>
            <TableRow>
              <TableHeaderCell>חודש</TableHeaderCell>
              {mode === 'per-store'
                ? storeNames.map((s) => <TableHeaderCell key={s} numeric>{s}</TableHeaderCell>)
                : <TableHeaderCell numeric>אחוז</TableHeaderCell>}
            </TableRow>
          </TableHead>
          <tbody>
            {months.map((m) => {
              const edited = isEdited(m);
              const dim = edited ? '' : 'text-ink-muted';
              return (
                <TableRow key={m} data-testid={`cogs-timeline-row-${m}`}>
                  <TableCell className={cn('tabular-nums', dim)}>
                    {m}
                    {edited && <Badge testid={`cogs-edited-${m}`} variant="edited">נערך</Badge>}
                  </TableCell>
                  {mode === 'per-store'
                    ? storeNames.map((s, i) => (
                        <TableCell key={s} numeric className={dim}>
                          <bdi dir="ltr" className="tabular-nums">{(effectiveCogsPct(settings, s, m) * 100).toFixed(0)}%</bdi>
                          {!edited && i === 0 && <Badge testid={`cogs-default-${m}`} variant="default">ברירת מחדל</Badge>}
                        </TableCell>
                      ))
                    : (
                      <TableCell numeric className={dim}>
                        <bdi dir="ltr" className="tabular-nums">{(effectiveCogsPct(settings, '', m) * 100).toFixed(0)}%</bdi>
                        {!edited && <Badge testid={`cogs-default-${m}`} variant="default">ברירת מחדל</Badge>}
                      </TableCell>
                    )}
                </TableRow>
              );
            })}
          </tbody>
            </TableBase>
          </div>
        )}
      </div>
    </Card>
  );
}

function clampPct(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_COGS_PCT;
  return Math.max(0, Math.min(100, n));
}

/** Last `n` calendar months ending at `endMonth` (inclusive), 'YYYY-MM' desc-then-sorted by caller. */
function lastNMonths(endMonth: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = endMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return out;
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

function Badge({ testid, variant, children }: { testid: string; variant: 'edited' | 'default'; children: React.ReactNode }) {
  return (
    <span
      data-testid={testid}
      className={cn(
        'ms-1.5 inline-block rounded-md px-1.5 py-0.5 text-2xs font-bold align-middle',
        variant === 'edited' ? 'bg-accent-soft text-accent' : 'bg-glass-3 text-ink-secondary',
      )}
    >
      {children}
    </span>
  );
}

function PctField({ label, testid, value, onChange }: { label: string; testid: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <div className="w-28">
        <Input
          data-testid={testid}
          aria-label={`${label} — אחוז COGS`}
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          prefix={<span className="text-xs font-bold">%</span>}
          className="text-center font-bold"
        />
      </div>
    </div>
  );
}

function Radio({ name, testid, checked, onChange, label }: { name: string; testid: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
      <Input type="radio" name={name} data-testid={testid} checked={checked} onChange={onChange} className="accent-accent w-4 h-4" />
      <span>{label}</span>
    </label>
  );
}
