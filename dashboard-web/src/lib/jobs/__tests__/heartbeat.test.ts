// dashboard-web/src/lib/jobs/__tests__/heartbeat.test.ts
//
// TDD tests for the lightweight cron HEARTBEAT helper.
//
// The 5 schedule-cadence crons (cron-live, cron-daily, cron-yesterday,
// whatsapp, oauth-canary) write NO separately-attributable run-telemetry, so
// the operator RunsPanel showed them as "אין נתון" (unknown) forever. This
// helper writes ONE lightweight `data_freshness` row per cron at the SUCCESSFUL
// end of its work (or a transient_error row on a caught failure) so the panel
// can light them up. It is a thin, best-effort wrapper over recordFreshness:
//
//   platform   : 'system'      (a dedicated non-platform lane)
//   store_id   : '__system__'  (sentinel — never a real store, never enumerated)
//   table_name : 'heartbeat'
//   scope      : the job key    (cron_live | cron_daily | … | oauth_canary)
//   status     : 'success' | 'transient_error'
//
// CRITICAL property: the heartbeat write is NON-FATAL. recordFreshness already
// swallows all DB errors internally, but the helper additionally guards so a
// thrown recordFreshness can NEVER break the cron's real work.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordFreshnessMock = vi.fn<(opts: unknown) => Promise<void>>();
vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: (opts: unknown) => recordFreshnessMock(opts),
}));

import {
  recordHeartbeat,
  HEARTBEAT_PLATFORM,
  HEARTBEAT_STORE_ID,
  HEARTBEAT_TABLE,
  type HeartbeatJobKey,
} from '../heartbeat';

beforeEach(() => {
  recordFreshnessMock.mockReset();
  recordFreshnessMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordHeartbeat', () => {
  it('writes a success heartbeat row with the system convention', async () => {
    await recordHeartbeat('cron_live', 'success');
    expect(recordFreshnessMock).toHaveBeenCalledTimes(1);
    expect(recordFreshnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: HEARTBEAT_STORE_ID,
        platform: HEARTBEAT_PLATFORM,
        scope: 'cron_live',
        tableName: HEARTBEAT_TABLE,
        status: 'success',
      }),
    );
  });

  it('uses the canonical sentinel convention values', () => {
    expect(HEARTBEAT_PLATFORM).toBe('system');
    expect(HEARTBEAT_STORE_ID).toBe('__system__');
    expect(HEARTBEAT_TABLE).toBe('heartbeat');
  });

  it('maps every job key onto its own scope', async () => {
    const keys: HeartbeatJobKey[] = [
      'cron_live',
      'cron_daily',
      'cron_yesterday',
      'whatsapp',
      'oauth_canary',
    ];
    for (const key of keys) {
      recordFreshnessMock.mockClear();
      await recordHeartbeat(key, 'success');
      expect(recordFreshnessMock).toHaveBeenCalledWith(
        expect.objectContaining({ scope: key, status: 'success' }),
      );
    }
  });

  it('writes a transient_error heartbeat with the error message on failure', async () => {
    await recordHeartbeat('oauth_canary', 'transient_error', 'boom: token expired');
    expect(recordFreshnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'oauth_canary',
        status: 'transient_error',
        errorMessage: 'boom: token expired',
      }),
    );
  });

  it('NEVER throws even if recordFreshness rejects (best-effort / non-fatal)', async () => {
    recordFreshnessMock.mockRejectedValue(new Error('db down'));
    await expect(recordHeartbeat('cron_daily', 'success')).resolves.toBeUndefined();
  });
});
