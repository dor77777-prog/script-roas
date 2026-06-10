// dashboard-web/src/lib/inngest/__tests__/planStoreJobs.test.ts
//
// Self-serve stores Phase 4b, Task 7 — the PURE oracle that guards the
// scheduler→worker fold. The per-store factory crons (cronDaily / cronLive /
// cronYesterdayRefresh) each register N functions (`STORES.map(makeFn)`,
// one per store). T8 folds them to a scheduler that loads stores at runtime
// and emits one event per store, consumed by one worker. `planStoreJobs` is
// the deterministic source of truth for "what per-store jobs would the old
// factory have run", so the same-fan-out guard can assert the new scheduler
// emits exactly that set.
//
// The factory handler signatures this oracle mirrors (do NOT change them):
//   - runDailyForStore(storeId, dateStr, ctx)  — cronDaily + cronYesterdayRefresh
//   - runLiveForStore(storeId, ctx)            — cronLive (no date arg)
// Each factory = one job per store. So planStoreJobs(stores, …).length === stores.length.

import { describe, expect, it } from 'vitest';
import { planStoreJobs, type StoreJob } from '@/lib/inngest/planStoreJobs';

const STORES = ['uzoshop', 'zolplus', 'usmile360'];

describe('planStoreJobs', () => {
  describe("family: 'daily'", () => {
    it('returns exactly one job per store, with the right shape', () => {
      const jobs = planStoreJobs(STORES, { family: 'daily', date: '2026-06-06' });

      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.storeId)).toEqual(STORES);

      expect(jobs).toEqual<StoreJob[]>([
        {
          storeId: 'uzoshop',
          eventName: 'cron/daily.store.requested',
          data: { storeId: 'uzoshop', date: '2026-06-06' },
          id: 'cron-daily-uzoshop-2026-06-06',
        },
        {
          storeId: 'zolplus',
          eventName: 'cron/daily.store.requested',
          data: { storeId: 'zolplus', date: '2026-06-06' },
          id: 'cron-daily-zolplus-2026-06-06',
        },
        {
          storeId: 'usmile360',
          eventName: 'cron/daily.store.requested',
          data: { storeId: 'usmile360', date: '2026-06-06' },
          id: 'cron-daily-usmile360-2026-06-06',
        },
      ]);
    });
  });

  describe("family: 'yesterday'", () => {
    it('returns one dated job per store on the yesterday event', () => {
      const jobs = planStoreJobs(STORES, { family: 'yesterday', date: '2026-06-05' });

      expect(jobs).toHaveLength(3);
      expect(jobs).toEqual<StoreJob[]>([
        {
          storeId: 'uzoshop',
          eventName: 'cron/yesterday.store.requested',
          data: { storeId: 'uzoshop', date: '2026-06-05' },
          id: 'cron-yesterday-uzoshop-2026-06-05',
        },
        {
          storeId: 'zolplus',
          eventName: 'cron/yesterday.store.requested',
          data: { storeId: 'zolplus', date: '2026-06-05' },
          id: 'cron-yesterday-zolplus-2026-06-05',
        },
        {
          storeId: 'usmile360',
          eventName: 'cron/yesterday.store.requested',
          data: { storeId: 'usmile360', date: '2026-06-05' },
          id: 'cron-yesterday-usmile360-2026-06-05',
        },
      ]);
    });

    // P0-2 (2026-06-10): the yesterday scheduler fires 12×/day with the SAME
    // date. Inngest dedupes events by id for 24h, so date-only ids made fires
    // 2-12 silently no-op — the every-2h cadence was inert. tickId must
    // produce a DIFFERENT id per fire while the payload stays date-only.
    it('two scheduler fires on the same date with different tickIds produce DIFFERENT event ids (Inngest dedupe fix)', () => {
      const fire1 = planStoreJobs(STORES, { family: 'yesterday', date: '2026-06-05', tickId: 'h00' });
      const fire2 = planStoreJobs(STORES, { family: 'yesterday', date: '2026-06-05', tickId: 'h02' });

      expect(fire1[0].id).toBe('cron-yesterday-uzoshop-2026-06-05-h00');
      expect(fire2[0].id).toBe('cron-yesterday-uzoshop-2026-06-05-h02');
      for (let i = 0; i < STORES.length; i++) {
        expect(fire1[i].id).not.toBe(fire2[i].id);
        // Payload is identical — only the id discriminates (tickId never leaks
        // into data, so the worker contract is unchanged).
        expect(fire1[i].data).toEqual(fire2[i].data);
        expect(fire1[i].data).toEqual({ storeId: STORES[i], date: '2026-06-05' });
      }
    });

    it('daily family (date only, one fire/day) keeps its historical id shape — the combine changes nothing', () => {
      const jobs = planStoreJobs(STORES, { family: 'daily', date: '2026-06-06' });
      expect(jobs[0].id).toBe('cron-daily-uzoshop-2026-06-06');
    });
  });

  describe("family: 'live'", () => {
    it('returns one job per store with NO date in data when none is supplied', () => {
      const jobs = planStoreJobs(STORES, { family: 'live' });

      expect(jobs).toHaveLength(3);
      expect(jobs).toEqual<StoreJob[]>([
        {
          storeId: 'uzoshop',
          eventName: 'cron/live.store.requested',
          data: { storeId: 'uzoshop' },
          id: 'cron-live-uzoshop',
        },
        {
          storeId: 'zolplus',
          eventName: 'cron/live.store.requested',
          data: { storeId: 'zolplus' },
          id: 'cron-live-zolplus',
        },
        {
          storeId: 'usmile360',
          eventName: 'cron/live.store.requested',
          data: { storeId: 'usmile360' },
          id: 'cron-live-usmile360',
        },
      ]);
    });

    it('uses a passed-in tick id as the id discriminator (deterministic, no Date.now)', () => {
      // runLiveForStore takes no date, so the live family relies on a caller-
      // supplied tick id (10-min bucket, as in registries/snapshots.tickIdForNow)
      // to keep ids collision-free across the every-10-min cadence — without the
      // oracle ever reading the clock itself.
      const jobs = planStoreJobs(STORES, { family: 'live', tickId: '2026-06-06T12:30' });

      expect(jobs.map((j) => j.id)).toEqual([
        'cron-live-uzoshop-2026-06-06T12:30',
        'cron-live-zolplus-2026-06-06T12:30',
        'cron-live-usmile360-2026-06-06T12:30',
      ]);
      // tickId is an id-only discriminator; it must NOT leak into the event
      // payload (runLiveForStore takes no date / tick).
      for (const j of jobs) {
        expect(j.data).toEqual({ storeId: j.storeId });
      }
    });
  });

  describe('extensibility', () => {
    it('a 4th store adds exactly one more job', () => {
      const three = planStoreJobs(STORES, { family: 'daily', date: '2026-06-06' });
      const four = planStoreJobs([...STORES, 'newstore'], { family: 'daily', date: '2026-06-06' });

      expect(four).toHaveLength(three.length + 1);
      expect(four.at(-1)).toEqual<StoreJob>({
        storeId: 'newstore',
        eventName: 'cron/daily.store.requested',
        data: { storeId: 'newstore', date: '2026-06-06' },
        id: 'cron-daily-newstore-2026-06-06',
      });
    });
  });

  describe('determinism + uniqueness', () => {
    it('same inputs produce identical ids', () => {
      const a = planStoreJobs(STORES, { family: 'daily', date: '2026-06-06' });
      const b = planStoreJobs(STORES, { family: 'daily', date: '2026-06-06' });
      expect(a.map((j) => j.id)).toEqual(b.map((j) => j.id));
    });

    it('ids are unique across stores within a family/date', () => {
      for (const family of ['daily', 'live', 'yesterday'] as const) {
        const jobs = planStoreJobs(STORES, { family, date: '2026-06-06' });
        const ids = jobs.map((j) => j.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });

  describe('empty store list', () => {
    it('returns []', () => {
      expect(planStoreJobs([], { family: 'daily', date: '2026-06-06' })).toEqual([]);
      expect(planStoreJobs([], { family: 'live' })).toEqual([]);
      expect(planStoreJobs([], { family: 'yesterday', date: '2026-06-05' })).toEqual([]);
    });
  });
});
