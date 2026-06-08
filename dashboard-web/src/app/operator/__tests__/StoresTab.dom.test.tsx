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
    hasWebhookSecret: true,
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
    hasWebhookSecret: false,
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

  it('opens the AddStoreWizard in EDIT mode when a matrix "החלף" action is clicked', async () => {
    // The GET[id] prefill must resolve so the slug locks. Default responder
    // returns a generic 200 {} for the [id] GET, which is enough here.
    render(<StoresTab />);
    await screen.findByText('360usmile');
    const row = screen.getByTestId('store-row-usmile360');
    // Meta is connected on usmile360 → its cell shows a rotate ("החלף") action.
    const metaCell = within(row).getByTestId('cred-cell-usmile360-meta');
    fireEvent.click(within(metaCell).getByRole('button', { name: /החלף|ערוך/ }));
    // EDIT mode mounts the wizard with the edit heading + prefilled, disabled slug.
    expect(await screen.findByText('עריכת חנות')).toBeDefined();
    const slug = screen.getByLabelText(/מזהה/) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toBe('usmile360');
  });

  it('connecting a MISSING platform from the matrix opens the wizard focused on it', async () => {
    // usmile360 prefill: only meta+shopify configured → Google is missing, so
    // clicking "חבר" must open EDIT focused on Google with the toggle pre-enabled.
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores();
      if (url.endsWith('/api/operator/stores/usmile360') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            storeId: 'usmile360',
            name: '360usmile',
            shopDomain: 'usmile360.myshopify.com',
            isHeadless: true,
            brandColor: 'var(--store-usm)',
            displayOrder: 3,
            hasTiktok: true,
            platforms: ['meta', 'shopify', 'tiktok'],
            hasWebhookSecret: false,
          }),
        };
      }
      if (url.includes('verify-creds')) {
        return { ok: true, status: 200, json: async () => ({ platform: 'google', ok: true, message: 'תקין' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    await screen.findByText('360usmile');
    const row = screen.getByTestId('store-row-usmile360');
    const googleCell = within(row).getByTestId('cred-cell-usmile360-google');
    fireEvent.click(within(googleCell).getByRole('button', { name: /חבר/ }));
    // Edit wizard opened + prefilled.
    await screen.findByText('עריכת חנות');
    await screen.findByDisplayValue('360usmile');
    // focusPlatform='google' pre-enabled the Google toggle → advancing to step 2
    // surfaces the Google cred block.
    fireEvent.click(screen.getByRole('button', { name: /הבא|Next/ }));
    expect(await screen.findByLabelText(/Google customer/i)).toBeDefined();
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

// ---------------------------------------------------------------------------
// Phase 6b Task 3 — archive / restore wiring + the "חנויות שהוסרו" removed-area.
// Archiving an active store POSTs to .../[id]/archive and re-fetches (the store
// moves active→removed-area); restoring POSTs to .../[id]/restore and re-fetches
// (it moves back). NO info loss — active list AND removed-area both visible.
// ---------------------------------------------------------------------------
describe('StoresTab — archive / restore (Phase 6b Task 3)', () => {
  // A mix: one active + one archived store.
  const MIXED: StoreRowData[] = [
    {
      storeId: 'uzoshop',
      name: 'uzoshop',
      brandColor: 'var(--store-uzo)',
      isHeadless: false,
      hasTikTok: true,
      status: 'active',
      displayOrder: 1,
      platforms: ['google', 'meta', 'shopify', 'tiktok'],
      hasWebhookSecret: true,
    },
    {
      storeId: 'oldstore',
      name: 'Old Store',
      brandColor: 'var(--store-3)',
      isHeadless: false,
      hasTikTok: false,
      status: 'archived',
      displayOrder: 9,
      platforms: ['shopify'],
      hasWebhookSecret: false,
    },
  ];

  function postCalls(suffix: string): number {
    return calls.filter(
      (c) => c.url.endsWith(suffix) && (c.init?.method ?? 'GET') === 'POST',
    ).length;
  }

  it('renders BOTH the active list and the removed-area (no info loss)', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    // Active store in the active list.
    expect(await screen.findByTestId('store-row-uzoshop')).toBeDefined();
    // Archived store in the removed-area.
    expect(screen.getByTestId('removed-store-row-oldstore')).toBeDefined();
    // The archived store is NOT in the active list, and vice versa.
    expect(screen.queryByTestId('store-row-oldstore')).toBeNull();
    expect(screen.queryByTestId('removed-store-row-uzoshop')).toBeNull();
  });

  it('archiving an active store POSTs to /archive and re-fetches', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    render(<StoresTab />);
    await screen.findByTestId('store-row-uzoshop');
    const beforeGet = countGetCalls();

    const row = screen.getByTestId('store-row-uzoshop');
    fireEvent.click(within(row).getByRole('button', { name: /העבר לארכיון/ }));

    // POST to the archive endpoint fired.
    await waitFor(() => expect(postCalls('/api/operator/stores/uzoshop/archive')).toBe(1));
    // And the list was re-fetched so the store moves to the removed-area.
    await waitFor(() => expect(countGetCalls()).toBeGreaterThan(beforeGet));
  });

  it('restoring an archived store POSTs to /restore and re-fetches', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    render(<StoresTab />);
    await screen.findByTestId('removed-store-row-oldstore');
    const beforeGet = countGetCalls();

    const row = screen.getByTestId('removed-store-row-oldstore');
    fireEvent.click(within(row).getByRole('button', { name: /שחזר/ }));

    await waitFor(() => expect(postCalls('/api/operator/stores/oldstore/restore')).toBe(1));
    await waitFor(() => expect(countGetCalls()).toBeGreaterThan(beforeGet));
  });

  it('surfaces a Hebrew error when archive POST fails (and does not crash)', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      if (url.endsWith('/archive') && method === 'POST') {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    await screen.findByTestId('store-row-uzoshop');
    fireEvent.click(within(screen.getByTestId('store-row-uzoshop')).getByRole('button', { name: /העבר לארכיון/ }));
    // A Hebrew error surfaces (mirrors the load-error pattern).
    expect(await screen.findByText(/נכשל/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Phase 6b T3-delete — the IRREVERSIBLE delete wiring. RemovedStores owns the
  // typed-name confirm modal; StoresTab supplies onDelete, which DELETEs to
  // .../[id] with {confirmName} and re-fetches on success. On a server error
  // (409/400) the modal stays open + shows the message (RemovedStores handles
  // the UI; StoresTab just returns {ok:false,error}).
  // -------------------------------------------------------------------------
  function deleteCalls(suffix: string): Array<{ url: string; init?: RequestInit }> {
    return calls.filter(
      (c) => c.url.endsWith(suffix) && (c.init?.method ?? 'GET') === 'DELETE',
    );
  }

  it('confirming delete DELETEs to .../[id] with {confirmName} and re-fetches', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      if (url.endsWith('/api/operator/stores/oldstore') && method === 'DELETE') {
        return { ok: true, status: 200, json: async () => ({ ok: true, deleted: 'oldstore', tablesWiped: [], failed: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    await screen.findByTestId('removed-store-row-oldstore');
    const beforeGet = countGetCalls();

    // Open the modal, type the exact name, confirm.
    const row = screen.getByTestId('removed-store-row-oldstore');
    fireEvent.click(within(row).getByRole('button', { name: /מחק לצמיתות.*Old Store/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/הקלד את שם החנות/), { target: { value: 'Old Store' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /מחק לצמיתות/ }));

    // A DELETE to the [id] route fired with the typed confirmName.
    await waitFor(() => expect(deleteCalls('/api/operator/stores/oldstore').length).toBe(1));
    const call = deleteCalls('/api/operator/stores/oldstore')[0];
    expect(JSON.parse(String(call.init?.body))).toEqual({ confirmName: 'Old Store' });
    // And the list was re-fetched so the wiped store disappears.
    await waitFor(() => expect(countGetCalls()).toBeGreaterThan(beforeGet));
    // The modal closed.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed delete (409) keeps the modal open and shows the server error', async () => {
    responder = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/operator/stores') && method === 'GET') return okStores(MIXED);
      if (url.endsWith('/api/operator/stores/oldstore') && method === 'DELETE') {
        return { ok: false, status: 409, json: async () => ({ error: 'archive the store before deleting it' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    render(<StoresTab />);
    await screen.findByTestId('removed-store-row-oldstore');

    const row = screen.getByTestId('removed-store-row-oldstore');
    fireEvent.click(within(row).getByRole('button', { name: /מחק לצמיתות.*Old Store/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/הקלד את שם החנות/), { target: { value: 'Old Store' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /מחק לצמיתות/ }));

    await waitFor(() => expect(deleteCalls('/api/operator/stores/oldstore').length).toBe(1));
    // The modal STAYS open and surfaces the server message.
    expect(await screen.findByText(/archive the store before deleting it/)).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});
