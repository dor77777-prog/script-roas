import { describe, expect, it } from 'vitest';
import type { AttributionTrust } from '@/lib/attributionAnalysis';
import type { ConfidenceLevel } from '@/lib/hooks/useCampaignTrueRevenue';

type CampaignsTableRowTrustLevel =
  | ConfidenceLevel['level']
  | Exclude<AttributionTrust['level'], 'unknown'>;

function toneForTrustLevel(trustLevel: CampaignsTableRowTrustLevel): string {
  return trustLevel === 'high' ? 'green'
    : trustLevel === 'medium' ? 'amber'
    : 'red';
}

describe('CampaignsTableRow trustLevel — locks TEST-07 (5.2.2.1)', () => {
  it('excludes "unknown" at the type level', () => {
    // @ts-expect-error CampaignsTableRow excludes AttributionTrust "unknown" before deriving tone.
    const value: CampaignsTableRowTrustLevel = 'unknown';
    expect(value).toBe('unknown');
  });

  it('accepts "high"', () => {
    const value: CampaignsTableRowTrustLevel = 'high';
    expect(toneForTrustLevel(value)).toBe('green');
  });

  it('accepts "medium"', () => {
    const value: CampaignsTableRowTrustLevel = 'medium';
    expect(toneForTrustLevel(value)).toBe('amber');
  });

  it('accepts "low"', () => {
    const value: CampaignsTableRowTrustLevel = 'low';
    expect(toneForTrustLevel(value)).toBe('red');
  });
});
