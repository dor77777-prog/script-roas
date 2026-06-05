// dashboard-web/src/lib/__tests__/postgresReadersPreferName.test.ts
//
// 2026-06-05 — name-selection rule for the Campaigns/Ads readers.
// The enriched views now expose a registry-backed name alias
// (reg_campaign_name / reg_ad_set_name / reg_ad_name) that COALESCEs the
// registry's current name with the per-day daily name. The readers must
// PREFER the registry alias, fall back to the per-day name, then to the
// em-dash. This pins that pure preference rule.

import { describe, it, expect } from 'vitest';
import { preferName } from '@/lib/postgresReaders';

describe('preferName(reg, daily)', () => {
  it('prefers the registry name when present', () => {
    expect(preferName('Registry Name', 'Daily Name')).toBe('Registry Name');
  });

  it('falls back to the daily name when registry is null', () => {
    expect(preferName(null, 'Daily Name')).toBe('Daily Name');
  });

  it('falls back to the daily name when registry is undefined', () => {
    expect(preferName(undefined, 'Daily Name')).toBe('Daily Name');
  });

  it('prefers a non-empty registry name even when it has surrounding whitespace', () => {
    expect(preferName('  Trimmed Reg  ', 'Daily Name')).toBe('Trimmed Reg');
  });

  it('returns the em-dash when both are null/empty', () => {
    expect(preferName(null, null)).toBe('—');
    expect(preferName(undefined, undefined)).toBe('—');
    expect(preferName('', '')).toBe('—');
    expect(preferName('  ', '  ')).toBe('—');
  });

  it('trims the daily fallback too', () => {
    expect(preferName(null, '  Daily  ')).toBe('Daily');
  });

  it('treats a blank-after-trim registry name as absent and falls back to daily', () => {
    // P2 hardening (2026-06-05): a genuine '' or whitespace registry name must
    // NOT shadow a present per-day name into an em-dash.
    expect(preferName('', 'Daily Name')).toBe('Daily Name');
    expect(preferName('   ', 'Daily Name')).toBe('Daily Name');
  });
});
