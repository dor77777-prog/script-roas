/**
 * Task 1.4 — freshness desaturation hook.
 *
 * `computeStaleness` is the pure mapper: ISO timestamp (or per-platform
 * record) + a `now` epoch → a 3-stage verdict that downstream CSS turns
 * into a saturate()+opacity filter via `[data-freshness]` on `.glass`.
 *
 * Thresholds (locked per plan + freshness-desaturation-thresholds):
 *   age < 15 min          → fresh
 *   15 min ≤ age < 30 min → aging
 *   age ≥ 30 min          → stale
 *   null / undefined ts   → stale (label: "—")
 *
 * Label formats:
 *   fresh / age < 60s     → "LIVE · Ns"
 *   fresh / age ≥ 60s     → "LIVE · Nm"
 *   aging                 → "AGING · Nmin"
 *   stale  / < 60 min     → "STALE · Nmin"
 *   stale  / ≥ 60 min     → "STALE · Xh Ymin"
 *
 * Per-platform path: `computeStaleness({ meta, google, tiktok }, now)`
 * computes each platform's stage and returns the WORST (stale > aging
 * > fresh) plus `worstPlatform` + `worstLabel` (e.g. "TikTok stuck · 1h 47min").
 *
 * `useStaleness` is the React wrapper: re-renders every 60s so the
 * label stays current. `computeStaleness` accepts `now` so it stays
 * pure for testing.
 */

import { useEffect, useState } from 'react';

export type FreshnessStage = 'fresh' | 'aging' | 'stale';

export interface StalenessResult {
  stage: FreshnessStage;
  minutesOld: number;
  label: string;
  worstPlatform?: string;
  worstLabel?: string;
}

type PerPlatformInput = Record<string, string | null | undefined>;
export type StalenessInput =
  | string
  | null
  | undefined
  | PerPlatformInput;

const FRESH_BREAK_MIN = 15;
const AGING_BREAK_MIN = 30;

const PLATFORM_DISPLAY: Record<string, string> = {
  meta:   'Meta',
  google: 'Google',
  tiktok: 'TikTok',
};

const STAGE_RANK: Record<FreshnessStage, number> = {
  fresh: 0,
  aging: 1,
  stale: 2,
};

function ageMinutes(updatedAt: string | null | undefined, now: number): number {
  if (updatedAt == null) return Infinity;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return Infinity;
  return Math.max(0, Math.floor((now - parsed) / 60_000));
}

function ageSeconds(updatedAt: string, now: number): number {
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return Infinity;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

function stageFromMinutes(min: number): FreshnessStage {
  if (min < FRESH_BREAK_MIN) return 'fresh';
  if (min < AGING_BREAK_MIN) return 'aging';
  return 'stale';
}

function formatStaleMinutes(min: number): string {
  if (!Number.isFinite(min)) return '—';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}

function buildLabel(
  stage: FreshnessStage,
  updatedAt: string | null | undefined,
  now: number,
): string {
  if (updatedAt == null) return '—';
  if (stage === 'fresh') {
    const sec = ageSeconds(updatedAt, now);
    if (sec < 60) return `LIVE · ${sec}s`;
    const min = Math.floor(sec / 60);
    return `LIVE · ${min}m`;
  }
  const min = ageMinutes(updatedAt, now);
  if (stage === 'aging') return `AGING · ${min}min`;
  return `STALE · ${formatStaleMinutes(min)}`;
}

function isRecord(v: unknown): v is PerPlatformInput {
  return typeof v === 'object' && v !== null;
}

export function computeStaleness(
  input: StalenessInput,
  now: number = Date.now(),
): StalenessResult {
  // Per-platform record branch
  if (isRecord(input)) {
    let worst: { stage: FreshnessStage; minutes: number; platform: string; ts: string | null } | null = null;
    for (const key of Object.keys(input)) {
      const ts = input[key] ?? null;
      const min = ageMinutes(ts, now);
      const stage = stageFromMinutes(min);
      if (
        worst === null ||
        STAGE_RANK[stage] > STAGE_RANK[worst.stage] ||
        (STAGE_RANK[stage] === STAGE_RANK[worst.stage] && min > worst.minutes)
      ) {
        worst = {
          stage,
          minutes: min,
          platform: PLATFORM_DISPLAY[key] ?? key,
          ts,
        };
      }
    }

    // Empty record → treat as null
    if (worst === null) {
      return { stage: 'stale', minutesOld: Infinity, label: '—' };
    }

    if (worst.stage === 'fresh') {
      // All platforms fresh — no per-platform highlight needed.
      // Top-level label still reflects the freshest representation;
      // use the worst (oldest) of the fresh ones.
      return {
        stage: 'fresh',
        minutesOld: worst.minutes,
        label: buildLabel('fresh', worst.ts, now),
      };
    }

    const stalePart = worst.ts == null ? '—' : formatStaleMinutes(worst.minutes);
    const worstLabel = `${worst.platform} stuck · ${stalePart}`;
    return {
      stage: worst.stage,
      minutesOld: worst.minutes,
      label: worstLabel,
      worstPlatform: worst.platform,
      worstLabel,
    };
  }

  // String / null branch
  if (input == null) {
    return { stage: 'stale', minutesOld: Infinity, label: '—' };
  }
  const min = ageMinutes(input, now);
  const stage = stageFromMinutes(min);
  return {
    stage,
    minutesOld: min,
    label: buildLabel(stage, input, now),
  };
}

/**
 * React wrapper: re-evaluates every 60s so the label clock stays current.
 * Use `computeStaleness` directly when you already manage your own clock.
 */
export function useStaleness(input: StalenessInput): StalenessResult {
  const [t, setT] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return computeStaleness(input, t);
}
