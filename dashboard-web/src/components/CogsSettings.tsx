'use client';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import {
  TableBase, TableHead, TableRow, TableHeaderCell, TableCell,
} from '@/components/ui/TableBase';
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

  const months = useMemo(() => Array.from(new Set([...monthsInData, currentMonth])).sort().reverse(), [monthsInData, currentMonth]);

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
      <h3 className="text-sm font-bold text-ink">הוצאות מלאי (COGS)</h3>

      {/* mode */}
      <div>
        <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1.5">מצב (גלובלי)</div>
        <div className="inline-flex rounded-md bg-glass-2 border border-glass-edge p-0.5 gap-0.5">
          <Button type="button" variant="ghost" data-testid="cogs-mode-business"
            onClick={() => switchMode('business')}
            className={cn('h-auto px-3 py-1.5 text-sm', mode === 'business' && 'bg-accent text-accent-fg')}>רמת עסק</Button>
          <Button type="button" variant="ghost" data-testid="cogs-mode-per-store"
            onClick={() => switchMode('per-store')}
            className={cn('h-auto px-3 py-1.5 text-sm', mode === 'per-store' && 'bg-accent text-accent-fg')}>רמת חנות</Button>
        </div>
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

      {/* timeline */}
      <div className="overflow-auto">
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
            {months.map((m) => (
              <TableRow key={m}>
                <TableCell className="tabular-nums">{m}</TableCell>
                {mode === 'per-store'
                  ? storeNames.map((s) => <TableCell key={s} numeric>{(effectiveCogsPct(settings, s, m) * 100).toFixed(0)}%</TableCell>)
                  : <TableCell numeric>{(effectiveCogsPct(settings, '', m) * 100).toFixed(0)}%</TableCell>}
              </TableRow>
            ))}
          </tbody>
        </TableBase>
      </div>
    </Card>
  );
}

function clampPct(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_COGS_PCT;
  return Math.max(0, Math.min(100, n));
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
    <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
      <Input type="radio" name={name} data-testid={testid} checked={checked} onChange={onChange} className="accent-accent w-4 h-4" />
      <span>{label}</span>
    </label>
  );
}
