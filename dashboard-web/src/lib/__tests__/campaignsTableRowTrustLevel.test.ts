import { describe, expect, it } from 'vitest';
import {
  computeTrustTone,
  type CampaignsTableRowTrustLevel,
} from '@/components/CampaignsTableRow';

// WR-02 (5.2.2.1): previously this test declared its own
// `CampaignsTableRowTrustLevel` alias and a local `toneForTrustLevel` mock,
// then asserted against THOSE. That meant the @ts-expect-error / value
// checks were exercising a type defined inside the test file, not the
// row's actual trustLevel derivation — a future regression that widened
// the row's narrowing (e.g., removing the `!attrUnknown` guard) would
// still type-check and still let this test pass.
//
// The fix exports `CampaignsTableRowTrustLevel` + `computeTrustTone` from
// CampaignsTableRow.tsx; this test now imports both so the assertions
// land on the production bindings.

describe('CampaignsTableRow trustLevel — locks TEST-07 (5.2.2.1)', () => {
  it('excludes "unknown" at the type level', () => {
    // @ts-expect-error CampaignsTableRow excludes AttributionTrust "unknown" before deriving tone.
    const value: CampaignsTableRowTrustLevel = 'unknown';
    expect(value).toBe('unknown');
  });

  it('maps "high" to the green chip tone via the production helper', () => {
    const value: CampaignsTableRowTrustLevel = 'high';
    expect(computeTrustTone(value)).toBe('bg-status-greenBg/60 text-status-green');
  });

  it('maps "medium" to the warning chip tone via the production helper', () => {
    const value: CampaignsTableRowTrustLevel = 'medium';
    expect(computeTrustTone(value)).toBe('bg-status-warning-bg text-status-warning-fg');
  });

  it('maps "low" to the red chip tone via the production helper', () => {
    const value: CampaignsTableRowTrustLevel = 'low';
    expect(computeTrustTone(value)).toBe('bg-status-redBg/60 text-status-red');
  });
});
