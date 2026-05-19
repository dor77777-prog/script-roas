import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the campaignProductMap migration helper.
 *
 * Scope: pins the WR-07 regression — `migrateProductMapKeys` uses an
 * explicit segment-count check instead of the legacy
 * `^[^:]+::[^:]+$` regex, so 2-segment detection is robust to colons
 * inside ids and to malformed empty segments.
 *
 * The shared vitest config uses `environment: 'node'` (no DOM), so we
 * shim a minimal `window.localStorage` + `window.dispatchEvent` here.
 * Adding a jsdom dependency just for this test would violate the
 * documented "DOM tests need a separate vitest config" boundary in
 * dashboard-web/vitest.config.ts.
 */

vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
}));

// Minimal localStorage shim. `window` already exists as a global in many
// node envs; we set it up before importing the module under test so the
// `typeof window === 'undefined'` short-circuits in readProductMap /
// writeProductMap evaluate to `false`.
function installWindowShim() {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
    dispatchEvent: () => true,
    // CustomEvent is used by writeProductMap but its return value is
    // ignored — a no-op shim is enough.
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).CustomEvent = class {
    constructor(public type: string) {}
  };
}

installWindowShim();

// Import AFTER the shim so the module-level checks see `window`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = await import('@/lib/campaignProductMap');
const { campaignKey, migrateProductMapKeys, writeProductMap } = mod;
type ProductMap = ReturnType<typeof mod.readProductMap>;

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).window.localStorage as { clear(): void }).clear();
});

describe('migrateProductMapKeys', () => {
  it('WR-07: migrates a legacy 2-segment key when exactly one platform matches the row data', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    expect(migrated[campaignKey('uzoshop', 'Meta', 'camp-1')]).toEqual(['prod-A']);
    // Legacy key removed.
    expect(migrated['uzoshop::camp-1']).toBeUndefined();
  });

  it('WR-07: skips a 3-segment (already migrated) key — explicit count, no regex false-positive', () => {
    const key3 = campaignKey('uzoshop', 'Meta', 'camp-1'); // "uzoshop::Meta::camp-1"
    writeProductMap({ [key3]: ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // 3-seg key untouched.
    expect(migrated[key3]).toEqual(['prod-A']);
  });

  it('WR-07: skips a malformed key with an empty segment ("storeId::" or "::campaignId")', () => {
    // Both halves of the split must be non-empty for migration to proceed.
    writeProductMap({
      'uzoshop::': ['prod-A'],
      '::camp-1': ['prod-B'],
    } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // Both malformed keys stay untouched — defensive against silently
    // mis-attributing a missing-half key to the wrong campaign.
    expect(migrated['uzoshop::']).toEqual(['prod-A']);
    expect(migrated['::camp-1']).toEqual(['prod-B']);
  });

  it('WR-07: preserves a 4+ segment key (defensive — colons in ids should NOT auto-migrate)', () => {
    // Hypothetical future input where a campaignId contained a colon
    // (manual sheet edit, future platform). The legacy regex
    // `^[^:]+::[^:]+$` would silently NOT match this anyway, but the
    // pre-WR-07 fallback used `.split('::')` destructuring which would
    // pick `['foo', '']` for a 3-piece split. Explicit count guards this.
    writeProductMap({ 'foo::bar::Meta::camp-1': ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'foo', campaignId: 'bar::Meta::camp-1', platform: 'Meta' }],
    });
    // Key untouched — segments.length === 4, not 2, so the migrator
    // leaves it alone rather than mis-parsing.
    expect(migrated['foo::bar::Meta::camp-1']).toEqual(['prod-A']);
  });

  it('keeps the legacy key when platform cannot be inferred (no matching rows)', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    // No rows match — platforms set is empty (size !== 1) → kept.
    const migrated = migrateProductMapKeys({ rows: [] });
    expect(migrated['uzoshop::camp-1']).toEqual(['prod-A']);
    expect(migrated[campaignKey('uzoshop', 'Meta', 'camp-1')]).toBeUndefined();
  });

  it('migration is idempotent on re-run (3-seg keys already migrated are skipped)', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    const once = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // Re-running on the migrated map shouldn't mutate it.
    const twice = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    expect(twice).toEqual(once);
  });
});
