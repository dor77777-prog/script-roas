'use client';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Money } from '@/components/ui/Money';
import {
  TableBase, TableHead, TableRow, TableHeaderCell, TableCell,
} from '@/components/ui/TableBase';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
import {
  DEFAULT_SALARY, effectiveSalaryEntry, applySalaryToScope,
  type SalaryApplyScope, type SalaryEntry,
} from '@/lib/salarySettings';

type ScopeKind = 'current' | 'specific' | 'all-previous' | 'everything';

export function SalarySettings({ currentMonth, monthsInData }: {
  currentMonth: string; monthsInData: string[];
}) {
  const [settings, update] = useSalarySettings();
  const [kind, setKind] = useState<SalaryEntry['kind']>(settings.default.kind ?? DEFAULT_SALARY.kind);
  const [value, setValue] = useState<string>(String(settings.default.value ?? DEFAULT_SALARY.value));
  const [scopeKind, setScopeKind] = useState<ScopeKind>('current');
  const [specificMonth, setSpecificMonth] = useState<string>(currentMonth);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Fixed 18-month lookback ∪ months-in-data ∪ every edited byMonth key, so
  // all-previous / specific-month / the timeline cover history independent of
  // the dashboard's current filter range (mirrors CogsSettings).
  const months = useMemo(() => {
    const set = new Set<string>([...lastNMonths(currentMonth, 18), ...monthsInData, currentMonth]);
    for (const m of Object.keys(settings.byMonth)) set.add(m);
    return Array.from(set).sort().reverse();
  }, [monthsInData, currentMonth, settings]);

  const isEdited = (m: string): boolean => settings.byMonth[m] !== undefined;

  const buildApply = (): SalaryApplyScope => {
    switch (scopeKind) {
      case 'current': return { kind: 'current', currentMonth };
      case 'specific': return { kind: 'specific', month: specificMonth };
      case 'all-previous': return { kind: 'all-previous', currentMonth };
      case 'everything': return { kind: 'everything' };
    }
  };

  const onApply = () => {
    const entry: SalaryEntry = { kind, value: clampValue(value, kind) };
    update(applySalaryToScope(settings, entry, buildApply(), months));
  };

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-bold text-ink">משכורות</h3>

      {/* entry-mode toggle: percent vs amount */}
      <div>
        <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1.5">מצב הזנה</div>
        <div className="inline-flex rounded-md bg-glass-2 border border-glass-edge p-0.5 gap-0.5">
          <Button type="button" variant="ghost" data-testid="salary-mode-percent"
            onClick={() => setKind('percent')}
            className={cn('h-auto px-3 py-1.5 text-sm', kind === 'percent' && 'bg-accent text-accent-fg')}>% מהמחזור</Button>
          <Button type="button" variant="ghost" data-testid="salary-mode-amount"
            onClick={() => setKind('amount')}
            className={cn('h-auto px-3 py-1.5 text-sm', kind === 'amount' && 'bg-accent text-accent-fg')}>סכום חודשי (CAD)</Button>
        </div>
      </div>

      {/* value field — prefix flips with mode */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm font-medium text-ink">כל העסק</span>
          <div className="w-32">
            <Input
              data-testid="salary-value-input"
              aria-label={kind === 'percent' ? 'משכורות — אחוז מהמחזור' : 'משכורות — סכום חודשי'}
              value={value}
              inputMode="decimal"
              dir="ltr"
              onChange={(e) => setValue(e.target.value)}
              prefix={<span className="text-xs font-bold">{kind === 'percent' ? '%' : 'CAD'}</span>}
              className="text-center font-bold"
            />
          </div>
        </div>
      </div>

      {/* apply-scope */}
      <fieldset className="space-y-1.5">
        <legend className="text-2xs uppercase tracking-wide text-ink-muted mb-1">החל על</legend>
        <Radio name="salary-scope" testid="salary-scope-current" checked={scopeKind === 'current'} onChange={() => setScopeKind('current')} label={`החודש הנוכחי (${currentMonth})`} />
        <Radio name="salary-scope" testid="salary-scope-specific" checked={scopeKind === 'specific'} onChange={() => setScopeKind('specific')} label="חודש ספציפי" />
        {scopeKind === 'specific' && (
          <div className="ms-6">
            <NativeSelect data-testid="salary-month" value={specificMonth} onChange={(e) => setSpecificMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </div>
        )}
        <Radio name="salary-scope" testid="salary-scope-all-previous" checked={scopeKind === 'all-previous'} onChange={() => setScopeKind('all-previous')} label="כל החודשים הקודמים" />
        <Radio name="salary-scope" testid="salary-scope-everything" checked={scopeKind === 'everything'} onChange={() => setScopeKind('everything')} label="הכל — קודמים + נוכחי + עתידיים" />
      </fieldset>

      <Button type="button" variant="primary" data-testid="salary-apply" onClick={onApply} className="w-full">החל שינוי</Button>

      <p className="text-2xs text-ink-muted leading-relaxed">
        ברירת מחדל {DEFAULT_SALARY.value}% לכל חודש שלא נערך. השינוי רטרואקטיבי ומיידי בכל הדשבורד. מסונכרן לענן.
      </p>

      {/* double-count reminder note */}
      <div data-testid="salary-double-count-note" className="rounded-lg bg-status-warningBg border border-status-warning px-3 py-2.5 flex items-start gap-2">
        <AlertCircle size={14} className="text-status-warningFg shrink-0 mt-0.5" />
        <div className="text-2xs text-status-warningFg leading-relaxed">
          אם הזנת משכורות ב&quot;עלויות קבועות&quot; — הסר משם כדי לא לספור פעמיים.
        </div>
      </div>

      {/* business-only note */}
      <p className="text-2xs text-ink-muted">ברמת העסק בלבד — אין הזנה לפי חנות.</p>

      {/* collapsible month timeline */}
      <div className="pt-1">
        <Button
          type="button"
          variant="ghost"
          data-testid="salary-timeline-toggle"
          aria-expanded={timelineOpen}
          aria-controls="salary-timeline-region"
          onClick={() => setTimelineOpen((v) => !v)}
          className="gap-1 h-auto px-2 py-1 text-[11px] sm:text-xs font-medium text-ink-secondary hover:text-ink"
        >
          {timelineOpen ? 'הסתר טבלת חודשים' : 'הצג טבלת חודשים'}
          {timelineOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </Button>
        {timelineOpen && (
          <div id="salary-timeline-region" data-testid="salary-timeline" className="mt-2 overflow-auto animate-fade-in">
            <TableBase density="compact" className="text-xs">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>חודש</TableHeaderCell>
                  <TableHeaderCell numeric>ערך אפקטיבי</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {months.map((m) => {
                  const edited = isEdited(m);
                  const entry = effectiveSalaryEntry(settings, m);
                  const dim = edited ? '' : 'text-ink-muted';
                  return (
                    <TableRow key={m} data-testid={`salary-timeline-row-${m}`}>
                      <TableCell className={cn('tabular-nums', dim)}>
                        {m}
                        {edited && <Badge testid={`salary-edited-${m}`} variant="edited">נערך</Badge>}
                      </TableCell>
                      <TableCell numeric className={dim}>
                        {entry.kind === 'percent'
                          ? `${entry.value}%`
                          : <><Money value={entry.value} /> <span className="text-2xs text-ink-muted">/ חודש</span></>}
                        {!edited && <Badge testid={`salary-default-${m}`} variant="default">ברירת מחדל</Badge>}
                      </TableCell>
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

function clampValue(v: string, kind: SalaryEntry['kind']): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return kind === 'percent' ? DEFAULT_SALARY.value : 0;
  return kind === 'percent' ? Math.min(100, n) : n; // amount is unbounded above
}

/** Last `n` calendar months ending at `endMonth` (inclusive), 'YYYY-MM'. */
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

function Radio({ name, testid, checked, onChange, label }: { name: string; testid: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
      <Input type="radio" name={name} data-testid={testid} checked={checked} onChange={onChange} className="accent-accent w-4 h-4" />
      <span>{label}</span>
    </label>
  );
}
