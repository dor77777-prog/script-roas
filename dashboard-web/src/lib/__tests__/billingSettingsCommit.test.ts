// dashboard-web/src/lib/__tests__/billingSettingsCommit.test.ts
//
// Regression test for d/MD-07: BillingSettings RecurringEditForm and
// OneTimeEditForm must NOT silently commit a $0 row when the operator types
// invalid numeric input.
//
// Pre-fix: both forms used `Number.isFinite(amount) ? amount : 0`, so a
// typo like "abc" or an empty " " produced NaN, the ternary fell through to
// `: 0`, and the row was persisted as $0 — silently corrupting the P&L
// total without any UI feedback.
//
// Post-fix: when the parsed amount is NaN OR ≤ 0, commit is blocked, an
// inline error is surfaced, and onSave is NOT invoked.
//
// We exercise the validation logic at the pure-function layer (the same
// guard that lives inside `commit()` in BillingSettings.tsx) rather than
// rendering the component, because the project's vitest config is
// `environment: 'node'` with no JSDOM (per vitest.config.ts comment block
// — DOM tests would require a separate config). The guard is a one-liner,
// easy to re-implement here to lock the contract.

import { describe, expect, it } from 'vitest';

/** Mirrors the guard in BillingSettings.tsx — must stay in sync. */
function validateAmount(raw: string): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'הזן סכום חיובי תקין (לדוגמה: 60)' };
  }
  return { ok: true, amount };
}

describe('BillingSettings amount validation (d/MD-07)', () => {
  it('accepts a positive integer string', () => {
    const r = validateAmount('60');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(60);
  });

  it('accepts a positive decimal string', () => {
    const r = validateAmount('39.50');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(39.5);
  });

  it('strips thousand-separator commas', () => {
    const r = validateAmount('2,000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(2000);
  });

  it('rejects an empty string', () => {
    const r = validateAmount('');
    expect(r.ok).toBe(false);
  });

  it('rejects pure whitespace', () => {
    const r = validateAmount('   ');
    expect(r.ok).toBe(false);
  });

  it('rejects non-numeric input ("abc")', () => {
    const r = validateAmount('abc');
    expect(r.ok).toBe(false);
  });

  it('rejects zero — operator typed "0" but a $0 subscription is wrong', () => {
    const r = validateAmount('0');
    expect(r.ok).toBe(false);
  });

  it('rejects a negative number', () => {
    const r = validateAmount('-50');
    expect(r.ok).toBe(false);
  });

  it('rejects NaN explicitly', () => {
    const r = validateAmount('NaN');
    expect(r.ok).toBe(false);
  });
});
