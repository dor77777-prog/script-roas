import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireJobLock, releaseJobLock } from '../lock';

// --- Mocks ------------------------------------------------------------------

// What supabase.rpc('acquire_job_lock', …) resolves to — tests override per-case.
const rpcMock = vi.fn();

// Captures the delete chain (delete().eq('key', …)) for release assertions.
const deleteEqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    rpc: rpcMock,
    from: (_table: string) => ({
      delete: deleteMock,
    }),
  }),
}));

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: true, error: null });
  deleteEqMock.mockReset().mockResolvedValue({ error: null });
  deleteMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ------------------------------------------------------------------

describe('acquireJobLock', () => {
  it('calls the acquire_job_lock RPC with the key + ttl and returns true on success', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    const got = await acquireJobLock('live:uzoshop');

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith('acquire_job_lock', {
      p_key: 'live:uzoshop',
      p_ttl_sec: 300,
    });
    expect(got).toBe(true);
  });

  it('returns false when another run holds a fresh lock (RPC returns false)', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const got = await acquireJobLock('live:uzoshop');

    expect(got).toBe(false);
  });

  it('honors a custom ttlSec', async () => {
    await acquireJobLock('meta:uzoshop:status', 120);

    expect(rpcMock).toHaveBeenCalledWith('acquire_job_lock', {
      p_key: 'meta:uzoshop:status',
      p_ttl_sec: 120,
    });
  });
});

describe('releaseJobLock', () => {
  it('deletes the lock row by key', async () => {
    await releaseJobLock('live:uzoshop');

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteEqMock).toHaveBeenCalledWith('key', 'live:uzoshop');
  });
});
