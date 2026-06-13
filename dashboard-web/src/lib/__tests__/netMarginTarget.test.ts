import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NET_MARGIN_TARGET_KEY, NET_MARGIN_TARGET_EVENT, NET_MARGIN_TARGET_VERSION,
  DEFAULT_NET_MARGIN_TARGET,
  defaultNetMarginTargetSettings, effectiveNetMarginTarget,
  readNetMarginTargetSettings, writeNetMarginTargetSettings,
  type NetMarginTargetSettings,
} from '@/lib/netMarginTarget';

const pushCloudKey = vi.fn();
vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: (...args: unknown[]) => pushCloudKey(...args) }));

function fakeWindow() {
  const store = new Map<string, string>();
  const events: string[] = [];
  const ls: Storage = {
    get length() { return store.size; }, clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  return {
    localStorage: ls,
    dispatchEvent: (e: Event) => { events.push((e as CustomEvent).type); return true; },
    CustomEvent: globalThis.CustomEvent ?? class extends Event {},
    __events: events,
  } as unknown as typeof window & { __events: string[] };
}

beforeEach(() => { pushCloudKey.mockClear(); vi.stubGlobal('window', fakeWindow()); });

describe('netMarginTarget — model + defaults', () => {
  it('default is 0.35 with an empty byMonth map', () => {
    const s = defaultNetMarginTargetSettings();
    expect(s).toEqual({ v: NET_MARGIN_TARGET_VERSION, default: DEFAULT_NET_MARGIN_TARGET, byMonth: {} });
    expect(DEFAULT_NET_MARGIN_TARGET).toBe(0.35);
  });

  it('exposes the canonical key + event constants', () => {
    expect(NET_MARGIN_TARGET_KEY).toBe('roas-dashboard:net-margin-target');
    expect(NET_MARGIN_TARGET_EVENT).toBe('roas-net-margin-target-changed');
  });

  it('read with no stored value → default 0.35', () => {
    const s = readNetMarginTargetSettings();
    expect(effectiveNetMarginTarget(s, '2026-06').value).toBe(0.35);
  });
});

describe('effectiveNetMarginTarget — exact > carry-forward > default', () => {
  const s: NetMarginTargetSettings = { v: 1, default: 0.35, byMonth: { '2026-03': 0.30, '2026-05': 0.40 } };

  it('exact month wins; carriedFrom is null', () => {
    expect(effectiveNetMarginTarget(s, '2026-05')).toEqual({ value: 0.40, carriedFrom: null });
    expect(effectiveNetMarginTarget(s, '2026-03')).toEqual({ value: 0.30, carriedFrom: null });
  });

  it('no exact → carries the LATEST earlier set month', () => {
    expect(effectiveNetMarginTarget(s, '2026-06')).toEqual({ value: 0.40, carriedFrom: '2026-05' });
    expect(effectiveNetMarginTarget(s, '2026-04')).toEqual({ value: 0.30, carriedFrom: '2026-03' });
  });

  it('no exact and no earlier set month → global default, null carry', () => {
    expect(effectiveNetMarginTarget(s, '2026-02')).toEqual({ value: 0.35, carriedFrom: null });
    expect(effectiveNetMarginTarget(s, '2026-01')).toEqual({ value: 0.35, carriedFrom: null });
  });

  it('respects a custom global default when no month is set', () => {
    const c: NetMarginTargetSettings = { v: 1, default: 0.5, byMonth: {} };
    expect(effectiveNetMarginTarget(c, '2026-06')).toEqual({ value: 0.5, carriedFrom: null });
  });
});

describe('read/write round-trip + cloud sync', () => {
  it('writes localStorage, fires the event, and pushes to cloud', () => {
    const next: NetMarginTargetSettings = { v: 1, default: 0.35, byMonth: { '2026-06': 0.30 } };
    writeNetMarginTargetSettings(next);
    expect((window as unknown as { __events: string[] }).__events).toContain(NET_MARGIN_TARGET_EVENT);
    expect(pushCloudKey).toHaveBeenCalledWith(NET_MARGIN_TARGET_KEY, expect.objectContaining({ byMonth: { '2026-06': 0.30 } }));
    const back = readNetMarginTargetSettings();
    expect(back.byMonth['2026-06']).toBe(0.30);
    expect(effectiveNetMarginTarget(back, '2026-06').value).toBe(0.30);
  });

  it('drops out-of-range / non-finite byMonth entries on read', () => {
    window.localStorage.setItem(NET_MARGIN_TARGET_KEY, JSON.stringify({
      v: 1, default: 0.35, byMonth: { '2026-06': 0.30, '2026-07': 5, '2026-08': -1, '2026-09': 'x' },
    }));
    const s = readNetMarginTargetSettings();
    expect(s.byMonth).toEqual({ '2026-06': 0.30 });
  });

  it('malformed JSON → default settings', () => {
    window.localStorage.setItem(NET_MARGIN_TARGET_KEY, '{not json');
    expect(readNetMarginTargetSettings()).toEqual(defaultNetMarginTargetSettings());
  });
});
