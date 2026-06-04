import { describe, it, expect } from 'vitest';
import { overridesActive, type OverrideRowAsRead } from '@/lib/home/overridesActive';

// Helper: build a manual_overrides row AS READ (mirrors the table shape:
// id, date, store_id, platform, spend, currency, notes, created_at, plus the
// forward-compat updated_at / applies_to fields).
function row(over: Partial<OverrideRowAsRead>): OverrideRowAsRead {
  return {
    id: 1,
    date: '2026-06-03',
    store_id: 'uzoshop',
    platform: 'meta',
    spend: 100,
    currency: 'CAD',
    notes: null,
    created_at: '2026-06-03T08:00:00.000Z',
    ...over,
  };
}

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('overridesActive', () => {
  it('returns anyActive=false and empty groups for no rows', () => {
    const out = overridesActive([], RANGE);
    expect(out.anyActive).toBe(false);
    expect(out.byStorePlatform).toEqual({});
  });

  it('in-range row → anyActive=true and grouped by display-store::platform', () => {
    const out = overridesActive(
      [row({ date: '2026-06-15', store_id: 'uzoshop', platform: 'meta', notes: 'acct outage' })],
      RANGE,
    );
    expect(out.anyActive).toBe(true);
    // store_id 'uzoshop' projects to display 'uzoshop'
    expect(out.byStorePlatform).toHaveProperty('uzoshop::meta');
    const g = out.byStorePlatform['uzoshop::meta'];
    expect(g.count).toBe(1);
    expect(g.note).toBe('acct outage');
  });

  it('projects store_id → display name via STORE_NAME_BY_ID', () => {
    const out = overridesActive(
      [
        row({ date: '2026-06-10', store_id: 'zolplus', platform: 'google' }),
        row({ date: '2026-06-11', store_id: 'usmile360', platform: 'tiktok' }),
      ],
      RANGE,
    );
    expect(out.byStorePlatform).toHaveProperty('Zol Plus::google');
    expect(out.byStorePlatform).toHaveProperty('360usmile::tiktok');
  });

  it('falls back to the raw store_id when no display mapping exists', () => {
    const out = overridesActive(
      [row({ date: '2026-06-10', store_id: 'unknownstore', platform: 'meta' })],
      RANGE,
    );
    expect(out.byStorePlatform).toHaveProperty('unknownstore::meta');
  });

  it('out-of-range rows → anyActive=false, no groups', () => {
    const out = overridesActive(
      [
        row({ date: '2026-05-31' }), // before from
        row({ date: '2026-07-01' }), // after to
      ],
      RANGE,
    );
    expect(out.anyActive).toBe(false);
    expect(out.byStorePlatform).toEqual({});
  });

  it('treats range bounds as inclusive on both ends', () => {
    const out = overridesActive(
      [
        row({ date: '2026-06-01', store_id: 'uzoshop', platform: 'meta' }),
        row({ date: '2026-06-30', store_id: 'zolplus', platform: 'google' }),
      ],
      RANGE,
    );
    expect(out.anyActive).toBe(true);
    expect(out.byStorePlatform['uzoshop::meta'].count).toBe(1);
    expect(out.byStorePlatform['Zol Plus::google'].count).toBe(1);
  });

  it('multiple rows in the same group → count sums; newest note + time win', () => {
    const out = overridesActive(
      [
        row({
          id: 1,
          date: '2026-06-05',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: 'older note',
          created_at: '2026-06-05T08:00:00.000Z',
        }),
        row({
          id: 2,
          date: '2026-06-20',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: 'newer note',
          created_at: '2026-06-20T08:00:00.000Z',
        }),
      ],
      RANGE,
    );
    const g = out.byStorePlatform['uzoshop::meta'];
    expect(g.count).toBe(2);
    expect(g.note).toBe('newer note');
    expect(g.lastEditedAt).toBe('2026-06-20T08:00:00.000Z');
  });

  it('prefers updated_at over created_at when present, and the latest wins', () => {
    const out = overridesActive(
      [
        row({
          id: 1,
          date: '2026-06-05',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: 'edited later',
          created_at: '2026-06-05T08:00:00.000Z',
          updated_at: '2026-06-25T12:00:00.000Z',
        }),
        row({
          id: 2,
          date: '2026-06-20',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: 'created later but not re-edited',
          created_at: '2026-06-20T08:00:00.000Z',
        }),
      ],
      RANGE,
    );
    const g = out.byStorePlatform['uzoshop::meta'];
    expect(g.count).toBe(2);
    // id 1's updated_at (06-25) beats id 2's created_at (06-20)
    expect(g.note).toBe('edited later');
    expect(g.lastEditedAt).toBe('2026-06-25T12:00:00.000Z');
  });

  it('skips null/empty notes when choosing the most-recent note', () => {
    const out = overridesActive(
      [
        row({
          id: 1,
          date: '2026-06-05',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: 'the only real note',
          created_at: '2026-06-05T08:00:00.000Z',
        }),
        row({
          id: 2,
          date: '2026-06-20',
          store_id: 'uzoshop',
          platform: 'meta',
          notes: null, // newer row but no note
          created_at: '2026-06-20T08:00:00.000Z',
        }),
      ],
      RANGE,
    );
    const g = out.byStorePlatform['uzoshop::meta'];
    expect(g.count).toBe(2);
    expect(g.note).toBe('the only real note');
    // lastEditedAt still reflects the genuinely most-recent row
    expect(g.lastEditedAt).toBe('2026-06-20T08:00:00.000Z');
  });

  it('keeps distinct store/platform combos in separate groups', () => {
    const out = overridesActive(
      [
        row({ date: '2026-06-05', store_id: 'uzoshop', platform: 'meta' }),
        row({ date: '2026-06-06', store_id: 'uzoshop', platform: 'google' }),
        row({ date: '2026-06-07', store_id: 'zolplus', platform: 'meta' }),
      ],
      RANGE,
    );
    expect(Object.keys(out.byStorePlatform).sort()).toEqual(
      ['Zol Plus::meta', 'uzoshop::google', 'uzoshop::meta'].sort(),
    );
  });

  it('handles undefined/null rows input defensively', () => {
    // @ts-expect-error — exercising the defensive runtime guard
    expect(overridesActive(undefined, RANGE)).toEqual({ anyActive: false, byStorePlatform: {} });
    // @ts-expect-error — exercising the defensive runtime guard
    expect(overridesActive(null, RANGE)).toEqual({ anyActive: false, byStorePlatform: {} });
  });
});
