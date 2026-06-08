/**
 * Tests for the 7-day first-touch freshness window.
 *
 * A first-touch older than FIRST_TOUCH_WINDOW_DAYS relative to the conversion
 * time is dropped — the customer is no longer credited to that paid platform.
 * 7 days matches Meta's 7-day click-attribution window (conservative).
 * See classifyOrderAttribution `conversionAt` parameter.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyOrderAttribution,
  FIRST_TOUCH_WINDOW_DAYS,
} from '../classifyOrderSource';

// Helper to build note_attributes from a k/v record.
function noteAttrs(
  kv: Record<string, string>,
): Array<{ name: string; value: string }> {
  return Object.entries(kv).map(([name, value]) => ({ name, value }));
}

// ISO date that is `daysAgo` days before the given base date.
function daysBeforeIso(base: string, daysAgo: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

const CONVERSION_AT = '2026-03-01T12:00:00.000Z';
const FT_ATTRS_META = {
  _ft_utm_source: 'facebook',
  _ft_utm_campaign: 'retargeting-q1',
  _ft_utm_id: 'meta-campaign-123',
};

describe('FIRST_TOUCH_WINDOW_DAYS constant', () => {
  it('is exported and equals 7', () => {
    expect(FIRST_TOUCH_WINDOW_DAYS).toBe(7);
  });
});

describe('first-touch freshness window gate', () => {
  it('drops first-touch when set_at is 60 days before conversionAt', () => {
    const setAt = daysBeforeIso(CONVERSION_AT, 60);
    const result = classifyOrderAttribution(
      {
        note_attributes: noteAttrs({
          ...FT_ATTRS_META,
          _ft_set_at: setAt,
        }),
      },
      { conversionAt: CONVERSION_AT },
    );

    // First-touch is gated out — all first-touch fields should be null/false.
    expect(result.firstTouchSource).toBeNull();
    expect(result.firstUtmId).toBeNull();
    expect(result.firstUtmCampaign).toBeNull();
    expect(result.firstUtmSource).toBeNull();
    expect(result.firstFbclidPresent).toBe(false);
    expect(result.firstGclidPresent).toBe(false);
    expect(result.firstTtclidPresent).toBe(false);
    expect(result.firstUtmMedium).toBeNull();
    expect(result.firstUtmContent).toBeNull();
    expect(result.firstUtmTerm).toBeNull();
    expect(result.firstSeenAt).toBeNull();
  });

  it('honors first-touch when set_at is 3 days before conversionAt (within window)', () => {
    const setAt = daysBeforeIso(CONVERSION_AT, 3);
    const result = classifyOrderAttribution(
      {
        note_attributes: noteAttrs({
          ...FT_ATTRS_META,
          _ft_set_at: setAt,
        }),
      },
      { conversionAt: CONVERSION_AT },
    );

    expect(result.firstTouchSource).toBe('meta-paid');
    expect(result.firstUtmId).toBe('meta-campaign-123');
    expect(result.firstUtmCampaign).toBe('retargeting-q1');
    expect(result.firstSeenAt).toBe(setAt);
  });

  it('honors first-touch when set_at is present but NO conversionAt passed (back-compat)', () => {
    const setAt = daysBeforeIso(CONVERSION_AT, 60); // stale, but no conversionAt
    const result = classifyOrderAttribution({
      note_attributes: noteAttrs({
        ...FT_ATTRS_META,
        _ft_set_at: setAt,
      }),
    });

    // No conversionAt → gate cannot fire → first-touch honored.
    expect(result.firstTouchSource).toBe('meta-paid');
    expect(result.firstUtmId).toBe('meta-campaign-123');
  });

  it('honors first-touch when _ft_set_at is absent but conversionAt is present (cannot gate)', () => {
    // No _ft_set_at — gate requires set_at to compute age; must honor the signal.
    const result = classifyOrderAttribution(
      {
        note_attributes: noteAttrs(FT_ATTRS_META), // no _ft_set_at
      },
      { conversionAt: CONVERSION_AT },
    );

    expect(result.firstTouchSource).toBe('meta-paid');
    expect(result.firstUtmId).toBe('meta-campaign-123');
    expect(result.firstSeenAt).toBeNull(); // correctly null (no set_at provided)
  });

  it('last-touch source is identical with and without the gate firing', () => {
    // Order arrived via a Google ad last-touch; first-touch is a stale Meta click.
    const setAt = daysBeforeIso(CONVERSION_AT, 60);
    const withGate = classifyOrderAttribution(
      {
        landing_site: '/?utm_source=google&utm_medium=cpc&gclid=abc123',
        note_attributes: noteAttrs({
          ...FT_ATTRS_META,
          _ft_set_at: setAt,
        }),
      },
      { conversionAt: CONVERSION_AT },
    );
    const withoutGate = classifyOrderAttribution({
      landing_site: '/?utm_source=google&utm_medium=cpc&gclid=abc123',
      note_attributes: noteAttrs({
        ...FT_ATTRS_META,
        _ft_set_at: setAt,
      }),
    });

    // Last-touch is identical in both cases.
    expect(withGate.source).toBe('google-paid');
    expect(withoutGate.source).toBe('google-paid');
    expect(withGate.source).toBe(withoutGate.source);
    // Gate only affects first-touch.
    expect(withGate.firstTouchSource).toBeNull();      // gated
    expect(withoutGate.firstTouchSource).toBe('meta-paid'); // honored (no conversionAt)
  });

  it('honors first-touch when set_at is exactly at boundary (7 days = within window)', () => {
    const setAt = daysBeforeIso(CONVERSION_AT, 7);
    const result = classifyOrderAttribution(
      {
        note_attributes: noteAttrs({
          ...FT_ATTRS_META,
          _ft_set_at: setAt,
        }),
      },
      { conversionAt: CONVERSION_AT },
    );

    // 7 days exactly is <= window → honored.
    expect(result.firstTouchSource).toBe('meta-paid');
  });

  it('drops first-touch when set_at is 8 days before conversionAt (just outside window)', () => {
    const setAt = daysBeforeIso(CONVERSION_AT, 8);
    const result = classifyOrderAttribution(
      {
        note_attributes: noteAttrs({
          ...FT_ATTRS_META,
          _ft_set_at: setAt,
        }),
      },
      { conversionAt: CONVERSION_AT },
    );

    expect(result.firstTouchSource).toBeNull();
    expect(result.firstUtmId).toBeNull();
  });
});
