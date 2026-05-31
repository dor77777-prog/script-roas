import { describe, expect, it } from 'vitest';
import { computeStaleness } from '../freshness/useStaleness';

/**
 * Task 1.4 — freshness desaturation hook.
 *
 * `computeStaleness(updatedAt, now)` maps an ISO timestamp (or a
 * per-platform record of timestamps) to a 3-stage freshness verdict
 * that downstream CSS turns into a saturate()+opacity filter on the
 * containing `.glass[data-freshness]` surface.
 *
 * Thresholds (locked, must match plan + freshness-desaturation-thresholds):
 *   age < 15 min          → fresh   (filter: none,            opacity: 1.00)
 *   15 min ≤ age < 30 min → aging   (filter: saturate(0.60),  opacity: 0.92)
 *   age ≥ 30 min          → stale   (filter: saturate(0.30),  opacity: 0.80)
 *   updatedAt == null     → stale   (label: "—")
 *
 * Label format:
 *   fresh / age < 60s     → "LIVE · Ns"
 *   fresh / age ≥ 60s     → "LIVE · Nm"
 *   aging                 → "AGING · Nmin"
 *   stale  / < 60 min     → "STALE · Nmin"
 *   stale  / ≥ 60 min     → "STALE · Xh Ymin"
 *   null timestamp        → "—"
 *
 * Per-platform path:
 *   computeStaleness({ meta, google, tiktok }, now) computes each
 *   platform's stage and returns the WORST (stale > aging > fresh)
 *   plus worstPlatform ('Meta'|'Google'|'TikTok') and a
 *   worstLabel like "TikTok stuck · 1h 47m".
 *   Top-level stage/minutesOld/label mirror the worst platform.
 */

const NOW = Date.parse('2026-05-31T12:00:00Z');

function isoMinutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}
function isoSecondsAgo(sec: number): string {
  return new Date(NOW - sec * 1000).toISOString();
}

describe('computeStaleness — string input, three stages', () => {
  it('fresh: age < 15 min', () => {
    const out = computeStaleness(isoMinutesAgo(0), NOW);
    expect(out.stage).toBe('fresh');
    expect(out.minutesOld).toBe(0);

    const out14 = computeStaleness(isoMinutesAgo(14), NOW);
    expect(out14.stage).toBe('fresh');
    expect(out14.minutesOld).toBe(14);
  });

  it('aging: 15 ≤ age < 30 min', () => {
    expect(computeStaleness(isoMinutesAgo(15), NOW).stage).toBe('aging');
    expect(computeStaleness(isoMinutesAgo(22), NOW).stage).toBe('aging');
    expect(computeStaleness(isoMinutesAgo(29), NOW).stage).toBe('aging');
  });

  it('stale: age ≥ 30 min', () => {
    expect(computeStaleness(isoMinutesAgo(30), NOW).stage).toBe('stale');
    expect(computeStaleness(isoMinutesAgo(47), NOW).stage).toBe('stale');
    expect(computeStaleness(isoMinutesAgo(60 * 5), NOW).stage).toBe('stale');
  });
});

describe('computeStaleness — null / undefined input', () => {
  it('treats null as stale with em-dash label', () => {
    expect(computeStaleness(null, NOW)).toEqual({
      stage: 'stale',
      minutesOld: Infinity,
      label: '—',
    });
  });

  it('treats undefined as stale with em-dash label', () => {
    expect(computeStaleness(undefined, NOW)).toEqual({
      stage: 'stale',
      minutesOld: Infinity,
      label: '—',
    });
  });
});

describe('computeStaleness — label formats', () => {
  it('fresh shows seconds when age < 60s', () => {
    expect(computeStaleness(isoSecondsAgo(8), NOW).label).toBe('LIVE · 8s');
    expect(computeStaleness(isoSecondsAgo(0), NOW).label).toBe('LIVE · 0s');
    expect(computeStaleness(isoSecondsAgo(59), NOW).label).toBe('LIVE · 59s');
  });

  it('fresh shows minutes when 60s ≤ age < 15min', () => {
    expect(computeStaleness(isoSecondsAgo(60), NOW).label).toBe('LIVE · 1m');
    expect(computeStaleness(isoMinutesAgo(4), NOW).label).toBe('LIVE · 4m');
    expect(computeStaleness(isoMinutesAgo(14), NOW).label).toBe('LIVE · 14m');
  });

  it('aging shows minutes', () => {
    expect(computeStaleness(isoMinutesAgo(15), NOW).label).toBe('AGING · 15min');
    expect(computeStaleness(isoMinutesAgo(22), NOW).label).toBe('AGING · 22min');
  });

  it('stale < 60min shows minutes', () => {
    expect(computeStaleness(isoMinutesAgo(30), NOW).label).toBe('STALE · 30min');
    expect(computeStaleness(isoMinutesAgo(47), NOW).label).toBe('STALE · 47min');
    expect(computeStaleness(isoMinutesAgo(59), NOW).label).toBe('STALE · 59min');
  });

  it('stale ≥ 60min shows "Xh Ymin"', () => {
    expect(computeStaleness(isoMinutesAgo(60), NOW).label).toBe('STALE · 1h 0min');
    expect(computeStaleness(isoMinutesAgo(72), NOW).label).toBe('STALE · 1h 12min');
    expect(computeStaleness(isoMinutesAgo(107), NOW).label).toBe('STALE · 1h 47min');
    expect(computeStaleness(isoMinutesAgo(60 * 26), NOW).label).toBe('STALE · 26h 0min');
  });
});

describe('computeStaleness — per-platform worst-stage path', () => {
  it('returns worst stage across platforms (stale wins)', () => {
    const out = computeStaleness(
      {
        meta:   isoMinutesAgo(2),   // fresh
        google: isoMinutesAgo(20),  // aging
        tiktok: isoMinutesAgo(107), // stale, worst
      },
      NOW,
    );
    expect(out.stage).toBe('stale');
    expect(out.worstPlatform).toBe('TikTok');
    expect(out.worstLabel).toBe('TikTok stuck · 1h 47min');
    expect(out.label).toBe(out.worstLabel);
    expect(out.minutesOld).toBe(107);
  });

  it('returns aging when worst is aging', () => {
    const out = computeStaleness(
      {
        meta:   isoMinutesAgo(2),   // fresh
        google: isoMinutesAgo(22),  // aging — worst
        tiktok: isoMinutesAgo(5),   // fresh
      },
      NOW,
    );
    expect(out.stage).toBe('aging');
    expect(out.worstPlatform).toBe('Google');
    expect(out.worstLabel).toBe('Google stuck · 22min');
    expect(out.label).toBe(out.worstLabel);
    expect(out.minutesOld).toBe(22);
  });

  it('returns fresh when every platform is fresh (no worstLabel)', () => {
    const out = computeStaleness(
      {
        meta:   isoMinutesAgo(2),
        google: isoMinutesAgo(5),
        tiktok: isoMinutesAgo(0),
      },
      NOW,
    );
    expect(out.stage).toBe('fresh');
    expect(out.worstPlatform).toBeUndefined();
    expect(out.worstLabel).toBeUndefined();
    expect(out.minutesOld).toBe(5);
  });

  it('treats a null platform timestamp as stale (worst possible)', () => {
    const out = computeStaleness(
      {
        meta:   isoMinutesAgo(2),
        google: null,
        tiktok: isoMinutesAgo(5),
      },
      NOW,
    );
    expect(out.stage).toBe('stale');
    expect(out.worstPlatform).toBe('Google');
    expect(out.worstLabel).toBe('Google stuck · —');
  });

  it('capitalises platform keys correctly (meta→Meta, google→Google, tiktok→TikTok)', () => {
    const meta = computeStaleness({ meta: isoMinutesAgo(40), google: null, tiktok: null }, NOW);
    // google + tiktok null tie at Infinity → first-found wins; verify Meta still appears
    // when it's the worst non-null platform
    expect(meta.worstPlatform).toMatch(/^(Meta|Google|TikTok)$/);

    const onlyGoogle = computeStaleness({ meta: isoMinutesAgo(1), google: isoMinutesAgo(40), tiktok: isoMinutesAgo(1) }, NOW);
    expect(onlyGoogle.worstPlatform).toBe('Google');

    const onlyTiktok = computeStaleness({ meta: isoMinutesAgo(1), google: isoMinutesAgo(1), tiktok: isoMinutesAgo(40) }, NOW);
    expect(onlyTiktok.worstPlatform).toBe('TikTok');

    const onlyMeta = computeStaleness({ meta: isoMinutesAgo(40), google: isoMinutesAgo(1), tiktok: isoMinutesAgo(1) }, NOW);
    expect(onlyMeta.worstPlatform).toBe('Meta');
  });
});

describe('computeStaleness — purity', () => {
  it('is pure (no implicit Date.now()): different `now` returns different stages from the same input', () => {
    const ts = '2026-05-31T11:50:00Z'; // 10 min before NOW
    const at12 = computeStaleness(ts, Date.parse('2026-05-31T12:00:00Z'));
    expect(at12.stage).toBe('fresh');
    const at1230 = computeStaleness(ts, Date.parse('2026-05-31T12:30:00Z'));
    expect(at1230.stage).toBe('stale');
  });
});
