'use client';

import { useState } from 'react';
import { Target, Edit3, Check, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { useNetMarginTargetSettings } from '@/lib/hooks/useNetMarginTarget';
import {
  effectiveNetMarginTarget, DEFAULT_NET_MARGIN_TARGET,
} from '@/lib/netMarginTarget';

/**
 * Inline editor for the per-month business-wide TARGET NET MARGIN — the
 * threshold the P&L synthesis line ("רווח נטו X% — מתחת/מעל ליעד Y%") compares
 * against. Mirrors the GoalTracker's ✎ inline-pencil affordance.
 *
 * Editing applies to `month` (the current IL month on the P&L tab), stored as a
 * per-month override with carry-forward + a global default of 35%. Input is a
 * percentage 0–100 → fraction. Empty clears THIS month's override (carry-forward
 * / default re-fills). Default stays 35% when never edited.
 */

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
function monthLabelHebrew(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = HEBREW_MONTHS[(m ?? 0) - 1] ?? month;
  return Number.isFinite(y) ? `${name} ${y}` : month;
}

/** Percentage string (0–100) → fraction (0–1), or null when invalid/out-of-range. */
function parsePctToFraction(v: string): number | null {
  const n = Number(v.replace(/,/g, '').replace(/%/g, '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n / 100;
}

export function NetMarginTargetEditor({ month }: { month: string }) {
  const [settings, update] = useNetMarginTargetSettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const eff = effectiveNetMarginTarget(settings, month);
  const effPct = Math.round(eff.value * 100);
  const hasExact = typeof settings.byMonth[month] === 'number';

  function startEdit() {
    setDraft(String(effPct));
    setError(null);
    setEditing(true);
  }
  function commit() {
    // Empty draft → clear THIS month's explicit override (carry-forward / default re-fills).
    if (draft.trim() === '') {
      const byMonth = { ...settings.byMonth };
      delete byMonth[month];
      update({ ...settings, byMonth });
      setError(null);
      setEditing(false);
      return;
    }
    const frac = parsePctToFraction(draft);
    if (frac === null) {
      setError('הזן אחוז בין 1 ל-100');
      return;
    }
    update({ ...settings, byMonth: { ...settings.byMonth, [month]: frac } });
    setError(null);
    setEditing(false);
  }
  function cancel() {
    setEditing(false);
    setDraft('');
    setError(null);
  }
  const draftInvalid = draft.trim() !== '' && parsePctToFraction(draft) === null;

  const carryTag = eff.carriedFrom ? (
    <span className="text-fs-2xs text-status-warningFg font-semibold">
      · נגרר מ-{monthLabelHebrew(eff.carriedFrom)}
    </span>
  ) : (!hasExact ? (
    <span className="text-fs-2xs text-ink-muted font-medium" data-testid="net-margin-default-tag">
      · ברירת מחדל
    </span>
  ) : null);

  return (
    <Card className="!p-3 sm:!p-4" data-testid="net-margin-target-editor">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0">
            <Target size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-fs-2xs uppercase tracking-wide text-ink-muted inline-flex items-center gap-1 flex-wrap">
              יעד רווח נטו {carryTag}
            </div>
            {editing ? (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="w-24">
                  <Input
                    data-testid="net-margin-target-input"
                    aria-label="יעד רווח נטו — אחוז"
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value.replace(/[^\d.,]/g, '')); if (error) setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
                    placeholder="35"
                    autoFocus
                    prefix={<span className="text-xs font-bold">%</span>}
                    error={error != null || draftInvalid}
                    className="text-center font-bold"
                  />
                </div>
                <Button data-testid="net-margin-target-save" onClick={commit} disabled={draftInvalid} size="sm">
                  <Check size={13} />
                  שמור
                </Button>
                <Button variant="secondary" size="icon" onClick={cancel} aria-label="בטל">
                  <X size={14} />
                </Button>
              </div>
            ) : (
              <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5" data-testid="net-margin-target-value">
                <bdi dir="ltr">{effPct}%</bdi>
              </div>
            )}
          </div>
        </div>
        {!editing && (
          <HelpTooltip content="ערוך יעד רווח נטו">
            <Button variant="ghost" size="icon" onClick={startEdit} aria-label="ערוך יעד רווח נטו" data-testid="net-margin-target-edit">
              <Edit3 size={13} />
            </Button>
          </HelpTooltip>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-status-warningFg mt-2" role="alert">
          {error}
        </p>
      )}
      {editing && !error && (
        <p className="text-[11px] text-ink-muted mt-2">
          הסף שאליו משווים את הרווח נטו בפועל ({monthLabelHebrew(month)}). ברירת מחדל {Math.round(DEFAULT_NET_MARGIN_TARGET * 100)}%. נשמר בענן, פר-חודש.
        </p>
      )}
    </Card>
  );
}
