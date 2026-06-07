// dashboard-web/src/app/operator/__tests__/StoresTab.dom.test.tsx
//
// Self-serve stores Phase 6a — Task 7: StoresTab DOM tests.
//
// StoresTab is the operator "חנויות" tab container. Unlike StoreList/StoreRow
// (presentational) and AddStoreWizard (owns its own POST/PATCH), StoresTab owns:
//   - the GET /api/operator/stores fetch on mount (UNWRAPPING `.stores`),
//   - the loading + Hebrew-error states (mirrors AdStateTab),
//   - the AddStoreWizard open/close state (ADD via the header button, EDIT via
//     StoreList's onEdit),
//   - the re-fetch-on-done so a newly-added/edited store appears immediately.
//
// Pattern mirrors AddStoreWizard.dom.test.tsx: mock @/lib/operatorClient
// (operatorFetch) with a scriptable responder and assert on roles / text / the
// recorded fetch calls. The AddStoreWizard itself is NOT mocked — we render the
// real wizard and assert its step-1 / edit affordances appear when opened.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const calls: Array<{ url: string; init?: RequestInit }> = [];
let responder: (url: string, init?: RequestInit) => FakeRes | Promise<FakeRes>;

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }),
}));

import { StoresTab } from '../StoresTab';
import type { StoreRowData } from '@/components/operator/StoreList';

// A fixture mirroring the GET /api/operator/stores row shape exactly.
const STORES: StoreRowData[] = [
  {
    storeId: 'uzoshop',
    name: 'uzoshop',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active',
    displayOrder: 1,
    platforms: ['google', 'meta', 'shopify', 'tiktok'],
  },
  {
    storeId: 'usmile360',
    name: '360usmile',
    brandColor: 'var(--store-usm)',
    isHeadless: true,
    // usmile360 participates in TikTok (shared account) → hasTikTok=true and
    // 'tiktok' is present in platforms (coherent with the GET derivation: platforms
    // = {shopify∪meta/google secrets}∪{tiktok from has_tiktok}). The earlier
    // fixture fabricated hasTikTok=false with no tiktok platform, which the GET
    // could never actually return for a TikTok-participating store.
    hasTikTok: true,
    status: 'active',
    displayOrder: 3,
    platforms: ['meta', 'shopify', 'tiktok'],
  },
];

function okStores(stores: StoreRowData[] = STORES): FakeRes {
  return { ok: true, status: 200, json: async () => ({ stores }) };
}

function countGetCalls(): number {
  return calls.filter(
    (c) => c.url.endsWith('/api/operator/stores') && (c.init?.method ?? 'GET') === 'GET',
  ).length;
}

beforeEach(() => {
  calls.length = 0;
  // Default: GET returns the fixture; any verify/create returns generic ok.
  responder = (url, init) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores();
    if (url.includes('verify-creds')) {
      return { ok: true, status: 200, json: async () => ({ platform: 'shopify', ok: true, message: 'תקין' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StoresTab — חנויות operator tab (Phase 6a Task 7)', () => {
  it('GETs /api/operator/stores on mount, unwraps .stores, and renders active store names', async () => {
    render(<StoresTab />);
    // The fetched store name appears once the GET resolves.
    expect(await screen.findByText('360usmile')).toBeDefined();
    // It fetched the right endpoint as a GET.
    const getCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores') && (c.init?.method ?? 'GET') === 'GET',
    );
    expect(getCall).toBeDefined();
  });

  it('shows a loading state before the fetch resolves', async () => {
    // Make the GET hang so the loading state is observable.
    let resolveGet!: (v: FakeRes) => void;
    const pending = new Promise<FakeRes>((res) => {
      resolveGet = res;
    });
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return pending;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    // A loading affordance is present before the GET resolves.
    expect(screen.getByText(/טוען/)).toBeDefined();
    // Resolve so the test ends cleanly.
    resolveGet(okStores());
    await screen.findByText('360usmile');
  });

  it('shows a Hebrew error when the GET is not ok', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    // The error message is in Hebrew (mirrors AdStateTab's pattern).
    expect(await screen.findByText(/טעינת|נכשל/)).toBeDefined();
    // The list/empty-state is NOT shown on error.
    expect(screen.queryByText('360usmile')).toBeNull();
  });

  it('opens the AddStoreWizard in ADD mode when "+ הוסף חנות" is clicked', async () => {
    render(<StoresTab />);
    await screen.findByText('360usmile');
    fireEvent.click(screen.getByRole('button', { name: /הוסף חנות/ }));
    // The wizard's step-1 slug field appears (proves the wizard mounted in ADD mode).
    expect(await screen.findByLabelText(/מזהה/)).toBeDefined();
    // ADD mode → the add heading, not the edit heading.
    expect(screen.getByText('הוספת חנות חדשה')).toBeDefined();
    // The slug field is editable in ADD mode (not disabled, unlike EDIT).
    expect((screen.getByLabelText(/מזהה/) as HTMLInputElement).disabled).toBe(false);
  });

  it('opens the AddStoreWizard in EDIT mode when a row edit button is clicked', async () => {
    render(<StoresTab />);
    await screen.findByText('360usmile');
    const row = screen.getByTestId('store-row-usmile360');
    fireEvent.click(within(row).getByRole('button', { name: /ערוך/ }));
    // EDIT mode mounts the wizard with the edit heading + prefilled, disabled slug.
    expect(await screen.findByText('עריכת חנות')).toBeDefined();
    const slug = screen.getByLabelText(/מזהה/) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toBe('usmile360');
  });

  it('re-fetches the list after the wizard calls onDone (cancel from ADD step 1)', async () => {
    render(<StoresTab />);
    await screen.findByText('360usmile');
    const beforeOpen = countGetCalls();

    // Open ADD, then cancel — the wizard's onCancel is wired to onDone, which
    // closes the wizard AND re-fetches the list.
    fireEvent.click(screen.getByRole('button', { name: /הוסף חנות/ }));
    await screen.findByLabelText(/מזהה/);
    fireEvent.click(screen.getByRole('button', { name: /ביטול/ }));

    // The list re-rendered (wizard closed) and a fresh GET fired.
    await waitFor(() => expect(countGetCalls()).toBeGreaterThan(beforeOpen));
    // Back to the list view.
    expect(await screen.findByText('360usmile')).toBeDefined();
  });
});
