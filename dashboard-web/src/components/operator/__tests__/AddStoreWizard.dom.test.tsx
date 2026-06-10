// dashboard-web/src/components/operator/__tests__/AddStoreWizard.dom.test.tsx
//
// Self-serve stores Phase 6a — Task 5: AddStoreWizard DOM tests (ADD mode).
//
// Covers the 3-step flow + live-verify gating + snippet/checklist success
// screen. The PATCH (edit) DOM test is added in T8 (which delivers the edit
// route); here we focus on ADD mode per the task spec.
//
// Pattern mirrors ManualOverridesCrud.dom.test.tsx / BackfillPicker.dom.test.tsx:
// mock @/lib/operatorClient (operatorFetch) and assert on roles / text / the
// recorded fetch calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

// A scriptable operatorFetch: each test pushes Response-like objects onto the
// queue; calls are recorded for assertion. Falls back to a generic 200 ok.
type FakeRes = { status: number; json: () => Promise<unknown> };
const calls: Array<{ url: string; init?: RequestInit }> = [];
let responder: (url: string, init?: RequestInit) => FakeRes;

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }),
}));

import { AddStoreWizard } from '../AddStoreWizard';

function jsonOf(init?: RequestInit): Record<string, unknown> {
  if (!init?.body) return {};
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  // Default: every verify returns ok:true; create returns a success body.
  responder = (url) => {
    if (url.includes('verify-creds')) {
      return { status: 200, json: async () => ({ platform: 'shopify', ok: true, message: 'תקין' }) };
    }
    if (url.endsWith('/api/operator/stores')) {
      return {
        status: 201,
        json: async () => ({
          ok: true,
          store: { storeId: 'glowlab', name: 'Glow Lab' },
          secretsSet: ['SHOPIFY_CLIENT_ID'],
          secretsMasked: { SHOPIFY_CLIENT_SECRET: '••••1234' },
          cartPublicToken: 'ct_TESTTOKEN_123',
        }),
      };
    }
    return { status: 200, json: async () => ({}) };
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Helpers -------------------------------------------------------------------

function fill(label: RegExp | string, value: string): void {
  const el = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
}

function fillValidStep1(slug = 'glowlab'): void {
  fill(/מזהה/, slug);
  fill(/שם תצוגה/, 'Glow Lab');
  fill(/דומיין/, 'glowlab.myshopify.com');
}

function clickNext(): void {
  fireEvent.click(screen.getByRole('button', { name: /הבא|Next/ }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AddStoreWizard — ADD mode (Phase 6a Task 5)', () => {
  it('renders step 1 with the basics fields', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    expect(screen.getByLabelText(/מזהה/)).toBeDefined();
    expect(screen.getByLabelText(/שם תצוגה/)).toBeDefined();
    expect(screen.getByLabelText(/דומיין/)).toBeDefined();
  });

  it('rejects the reserved slug __global__ with an inline error and blocks Next', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fill(/מזהה/, '__global__');
    fill(/שם תצוגה/, 'Glow Lab');
    fill(/דומיין/, 'glowlab.myshopify.com');
    clickNext();
    // Still on step 1 — credentials heading should not be present.
    expect(screen.queryByText(/Shopify client_id/i)).toBeNull();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('rejects an invalid slug "Bad Id" and blocks Next', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fill(/מזהה/, 'Bad Id');
    fill(/שם תצוגה/, 'Glow Lab');
    fill(/דומיין/, 'glowlab.myshopify.com');
    clickNext();
    expect(screen.queryByText(/Shopify client_id/i)).toBeNull();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('advances to step 2 with a valid slug, showing Shopify creds always', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    expect(screen.getByLabelText(/Shopify client_id/i)).toBeDefined();
    expect(screen.getByLabelText(/Shopify.*secret/i)).toBeDefined();
  });

  it('does NOT show Meta creds in step 2 when Meta is unchecked', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    expect(screen.queryByLabelText(/Meta access[_ ]?token/i)).toBeNull();
  });

  it('shows Meta creds in step 2 after checking Meta in step 1', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    // Toggle Meta on (the platform switch is labelled "Meta").
    fireEvent.click(screen.getByRole('switch', { name: /Meta/i }));
    clickNext();
    expect(screen.getByLabelText(/Meta access[_ ]?token/i)).toBeDefined();
    expect(screen.getByLabelText(/Meta.*account/i)).toBeDefined();
  });

  it('disables Create until Shopify verify returns ✓', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    const create = screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it('enables Create after a successful Shopify verify (✓)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByRole('button', { name: /בדוק/ }));
    // The ✓ indicator appears asynchronously after the fetch resolves.
    await screen.findByText(/תקין/);
    const create = screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
  });

  it('clears a stale Shopify ✓ when a credential changes (re-disables Create)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByRole('button', { name: /בדוק/ }));
    await screen.findByText(/תקין/);
    const create = screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement;
    // Verified → Create enabled.
    expect(create.disabled).toBe(false);

    // Editing a Shopify credential invalidates the prior ✓.
    fill(/Shopify client_id/i, 'cid_CHANGED');
    expect(screen.queryByText(/תקין/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('clears a stale Shopify ✓ when shopDomain (step 1) changes', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByRole('button', { name: /בדוק/ }));
    await screen.findByText(/תקין/);
    expect(
      (screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Go back to step 1 and change the domain — that is part of the Shopify
    // probe, so the prior ✓ must be invalidated.
    fireEvent.click(screen.getByRole('button', { name: /חזרה/ }));
    fill(/דומיין/, 'glowlab2.myshopify.com');
    clickNext();
    // ✓ is gone and Create is disabled again.
    expect(screen.queryByText(/תקין/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows an inline error and blocks Next when the name is blank', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fill(/מזהה/, 'glowlab');
    fill(/דומיין/, 'glowlab.myshopify.com');
    // Name left blank.
    clickNext();
    // Still on step 1 — credentials not shown.
    expect(screen.queryByText(/Shopify client_id/i)).toBeNull();
    // An inline name error is surfaced (role="alert" from the Input error slot).
    expect(screen.getByText(/שם תצוגה נדרש/)).toBeDefined();
  });

  it('the "save anyway" override enables Create without a verify', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    const create = screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
  });

  it('Create POSTs to /api/operator/stores with the correct body shape', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    // Enable Meta so the body carries a meta block too.
    fireEvent.click(screen.getByRole('switch', { name: /Meta/i }));
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fill(/Meta access[_ ]?token/i, 'meta_tok');
    fill(/Meta.*account/i, 'act_999');
    // Skip verify via override so the test is deterministic.
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));

    await screen.findByText(/ct_TESTTOKEN_123/);

    const createCall = calls.find((c) => c.url.endsWith('/api/operator/stores'));
    expect(createCall).toBeDefined();
    expect(createCall!.init?.method).toBe('POST');
    const body = jsonOf(createCall!.init);
    expect(body.storeId).toBe('glowlab');
    expect(body.name).toBe('Glow Lab');
    expect(body.shopDomain).toBe('glowlab.myshopify.com');
    expect(body.isHeadless).toBe(false);
    expect(typeof body.brandColor).toBe('string');
    expect(body.hasTiktok).toBe(false);
    expect(body.shopify).toEqual({ clientId: 'cid_123', clientSecret: 'shpss_secret' });
    expect(body.meta).toEqual({ token: 'meta_tok', adAccountId: 'act_999' });
    expect(body.google).toBeUndefined();
  });

  it('on success renders step 3 with the themed snippet token + checklist; Done calls onDone', async () => {
    const onDone = vi.fn();
    render(<AddStoreWizard onDone={onDone} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));

    // Step 3: the themed pixel embeds the cartPublicToken from the response.
    await screen.findByText(/ct_TESTTOKEN_123/);
    // Checklist mentions the Shopify scopes.
    expect(screen.getByText(/read_customers/)).toBeDefined();
    // TikTok manual-mapping note is present.
    expect(screen.getByText(/TikTok/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /סיום/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('step 3 THEMED: secondary CodeBlock is labelled as a theme/cart-attr snippet (not "Edge function"), and checklist covers both snippets', async () => {
    // Default responder returns isHeadless=false (themed store).
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));

    // Wait for Step 3 to render.
    await screen.findByText(/ct_TESTTOKEN_123/);

    // The secondary CodeBlock label must NOT say "Edge function" for a themed store.
    expect(screen.queryByText('Edge function')).toBeNull();

    // The secondary CodeBlock label must mention theme / cart attrs / _ft_.
    expect(screen.getAllByText(/theme|תבנית|cart\.attr|_ft_/i).length).toBeGreaterThan(0);

    // Checklist must include instructions to paste the Custom Pixel (primary).
    expect(screen.getAllByText(/Custom Pixel/i).length).toBeGreaterThan(0);

    // Checklist must also include instructions to paste the Theme snippet (secondary).
    expect(screen.getAllByText(/[Tt]heme snippet|theme\.liquid/i).length).toBeGreaterThan(0);
  });

  it('surfaces the server 409 error on Create (duplicate store id)', async () => {
    responder = (url) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'shopify', ok: true, message: 'תקין' }) };
      }
      return { status: 409, json: async () => ({ error: 'a store with this id already exists' }) };
    };
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));

    await screen.findByText(/already exists/);
    // Still on step 2 — no snippet rendered.
    expect(screen.queryByText(/ct_TESTTOKEN_123/)).toBeNull();
  });

  it('Create is disabled while the request is in flight (no double submit)', async () => {
    // Make the create call hang so we can observe the in-flight disabled state.
    let resolveCreate!: (v: FakeRes) => void;
    const pending = new Promise<FakeRes>((res) => {
      resolveCreate = res;
    });
    responder = (url) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'shopify', ok: true, message: 'תקין' }) };
      }
      // Return the pending promise (operatorFetch awaits it).
      return pending as unknown as FakeRes;
    };
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    const create = screen.getByRole('button', { name: /צור חנות/ }) as HTMLButtonElement;
    fireEvent.click(create);
    // In-flight: button is disabled.
    expect(create.disabled).toBe(true);

    // Resolve so the test ends cleanly.
    resolveCreate({
      status: 201,
      json: async () => ({ ok: true, store: { storeId: 'glowlab' }, cartPublicToken: 'ct_TESTTOKEN_123' }),
    });
    await screen.findByText(/ct_TESTTOKEN_123/);
  });

  it('renders the verify control inside step 2 (smoke for the per-platform UI)', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    const section = screen.getByText(/Shopify client_id/i).closest('form') ?? document.body;
    expect(within(section as HTMLElement).getByRole('button', { name: /בדוק/ })).toBeDefined();
  });

  it('exposes a webhook signing-secret field in the Shopify section (D3)', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    const field = screen.getByLabelText(/סוד חתימת Webhook/i) as HTMLInputElement;
    expect(field).toBeDefined();
    // It is a secret input (type=password).
    expect(field.type).toBe('password');
  });

  it('sends the webhookSecret in the POST body when provided (D3)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fill(/סוד חתימת Webhook/i, 'WH-SIGNING-SECRET');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));
    await screen.findByText(/ct_TESTTOKEN_123/);
    const createCall = calls.find((c) => c.url.endsWith('/api/operator/stores'));
    const body = jsonOf(createCall!.init);
    expect(body.webhookSecret).toBe('WH-SIGNING-SECRET');
  });

  it('the step-3 checklist no longer claims the signing secret IS the client secret (MF-2 fix)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    fillValidStep1();
    clickNext();
    fill(/Shopify client_id/i, 'cid_123');
    fill(/Shopify.*secret/i, 'shpss_secret');
    fireEvent.click(screen.getByLabelText(/שמור בכל זאת/));
    fireEvent.click(screen.getByRole('button', { name: /צור חנות/ }));
    await screen.findByText(/ct_TESTTOKEN_123/);
    // The corrected copy explicitly says it is NOT the Client Secret.
    expect(screen.getByText(/לא ה-Client Secret/)).toBeDefined();
    // The old, wrong wording (signing secret = the app API/Client secret) is gone.
    expect(screen.queryByText(/signing secret = ה-API secret key/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EDIT mode (Phase 6a Task 8) — prefill basics + rotate-only-verify-gating.
// ---------------------------------------------------------------------------
describe('AddStoreWizard — EDIT mode (Phase 6a Task 8)', () => {
  // The GET prefill payload the edit route returns (basics only, NO secrets).
  const PREFILL = {
    storeId: 'mystore',
    name: 'My Store',
    shopDomain: 'mystore.myshopify.com',
    isHeadless: false,
    brandColor: 'var(--store-uzo)',
    displayOrder: 2,
    hasTiktok: true,
    enableCustomerJourney: false,
    platforms: ['shopify', 'meta'],
    hasWebhookSecret: false,
  };

  beforeEach(() => {
    // Default edit responder: GET prefill, verify ok, PATCH success.
    responder = (url, init) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'meta', ok: true, message: 'תקין' }) };
      }
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => PREFILL };
      }
      if (url.endsWith('/api/operator/stores/mystore') && init?.method === 'PATCH') {
        return {
          status: 200,
          json: async () => ({ ok: true, store: { storeId: 'mystore' }, updated: [], secretsMasked: {} }),
        };
      }
      return { status: 200, json: async () => ({}) };
    };
  });

  it('GETs the store on mount and prefills the step-1 basics', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    // Name is prefilled from the GET (async).
    await screen.findByDisplayValue('My Store');
    expect((screen.getByLabelText(/דומיין/) as HTMLInputElement).value).toBe('mystore.myshopify.com');
    // The slug field is locked in edit mode.
    expect((screen.getByLabelText(/מזהה/) as HTMLInputElement).disabled).toBe(true);
    // The GET was made.
    const getCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && (c.init?.method ?? 'GET') === 'GET',
    );
    expect(getCall).toBeDefined();
  });

  it('prefilled Meta toggle surfaces the Meta cred block in step 2 (empty fields)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    const metaToken = (await screen.findByLabelText(/Meta access[_ ]?token/i)) as HTMLInputElement;
    // Cred fields start EMPTY (leave-empty-to-keep semantics).
    expect(metaToken.value).toBe('');
  });

  it('shows "שמור שינויים" (not "צור חנות") in edit mode', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    expect(screen.getByRole('button', { name: /שמור שינויים/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /צור חנות/ })).toBeNull();
  });

  it('submitting basics-only (no creds touched) PATCHes WITHOUT any cred blocks', async () => {
    const onDone = vi.fn();
    render(<AddStoreWizard onDone={onDone} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    // Change the name only.
    fill(/שם תצוגה/, 'My Store Renamed');
    clickNext();
    // No platform was rotated → Save is enabled without any verify (untouched
    // platforms need no ✓).
    const save = screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 0));

    const patchCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && c.init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = jsonOf(patchCall!.init);
    expect(body.name).toBe('My Store Renamed');
    // No cred objects when nothing was rotated.
    expect(body.shopify).toBeUndefined();
    expect(body.meta).toBeUndefined();
    expect(body.google).toBeUndefined();
    expect(onDone).toHaveBeenCalled();
  });

  it('rotating Meta REQUIRES a fresh verify ✓ before the PATCH includes its creds', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    // Type new Meta creds — the platform is now "rotated", so Save must gate on ✓.
    fill(/Meta access[_ ]?token/i, 'NEW-META-TOKEN');
    fill(/Meta.*account/i, 'act_777');
    const save = screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement;
    // Not verified yet → disabled.
    expect(save.disabled).toBe(true);
    // Verify Meta.
    const metaBlock = screen.getByText('Meta').closest('div')!;
    fireEvent.click(within(metaBlock.parentElement as HTMLElement).getByRole('button', { name: /בדוק/ }));
    await screen.findByText(/תקין/);
    expect((screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /שמור שינויים/ }));
    await new Promise((r) => setTimeout(r, 0));
    const patchCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && c.init?.method === 'PATCH',
    );
    const body = jsonOf(patchCall!.init);
    // The rotated platform's full cred set is included.
    expect(body.meta).toEqual({ token: 'NEW-META-TOKEN', adAccountId: 'act_777' });
  });

  it('an untouched platform does NOT require verify (Save enabled on a basics-only edit)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    fill(/שם תצוגה/, 'Renamed Again');
    clickNext();
    // Shopify + Meta are configured but UNTOUCHED → no ✓ required.
    expect((screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // D3 — webhookSecret field (set/not-set in edit, never prefilled) +
  // focusPlatform pre-enable.
  // -------------------------------------------------------------------------
  it('shows the webhook signing-secret status (לא מוגדר) in EDIT mode and never prefills a value', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    // hasWebhookSecret=false → status reads "לא מוגדר" (not the secret value).
    expect(screen.getByText(/לא מוגדר/)).toBeDefined();
    // The field itself, if rendered, must be EMPTY (never prefilled with a secret).
    const field = screen.queryByLabelText(/סוד חתימת Webhook/i) as HTMLInputElement | null;
    if (field) expect(field.value).toBe('');
  });

  it('shows "מוגדר" when hasWebhookSecret is true (still never prefills the value)', async () => {
    responder = (url, init) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'meta', ok: true, message: 'תקין' }) };
      }
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => ({ ...PREFILL, hasWebhookSecret: true }) };
      }
      return { status: 200, json: async () => ({}) };
    };
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    expect(screen.getByText(/מוגדר/)).toBeDefined();
    const field = screen.queryByLabelText(/סוד חתימת Webhook/i) as HTMLInputElement | null;
    if (field) expect(field.value).toBe('');
  });

  it('sends webhookSecret in the PATCH body when the operator enters one (D3)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    fill(/סוד חתימת Webhook/i, 'NEW-WEBHOOK-SIGNING-SECRET');
    const save = screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false); // webhookSecret needs no cred verify
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 0));
    const patchCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && c.init?.method === 'PATCH',
    );
    const body = jsonOf(patchCall!.init);
    expect(body.webhookSecret).toBe('NEW-WEBHOOK-SIGNING-SECRET');
  });

  it('focusPlatform="google" pre-enables the Google toggle so its cred block shows in step 2 (D3)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" focusPlatform="google" />);
    // P2-43 (2026-06-10): focusPlatform now lands DIRECTLY on the credential
    // step — the pre-enabled Google cred block is visible without clicking
    // through step 1.
    expect(await screen.findByLabelText(/Google customer/i)).toBeDefined();
    // Walking back to step 1 shows the pre-enabled switch.
    fireEvent.click(screen.getByRole('button', { name: /חזרה/ }));
    const googleSwitch = screen.getByRole('switch', { name: /Google/i }) as HTMLButtonElement;
    expect(googleSwitch.getAttribute('aria-checked')).toBe('true');
  });

  it('focusPlatform="tiktok" pre-enables has_tiktok (no creds needed)', async () => {
    // mystore prefill has hasTiktok=true already; use a no-tiktok prefill to prove
    // the pre-enable actually flips it.
    responder = (url, init) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'meta', ok: true, message: 'תקין' }) };
      }
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => ({ ...PREFILL, hasTiktok: false }) };
      }
      if (url.endsWith('/api/operator/stores/mystore') && init?.method === 'PATCH') {
        return { status: 200, json: async () => ({ ok: true, store: { storeId: 'mystore' }, updated: [], secretsMasked: {} }) };
      }
      return { status: 200, json: async () => ({}) };
    };
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" focusPlatform="tiktok" />);
    // P2-43 (2026-06-10): focusPlatform lands on the credential step; walk
    // back to step 1 to see the pre-enabled TikTok toggle (no creds needed).
    await screen.findByLabelText(/Shopify client_id/i);
    fireEvent.click(screen.getByRole('button', { name: /חזרה/ }));
    const tkSwitch = screen.getByRole('switch', { name: /TikTok/i }) as HTMLButtonElement;
    expect(tkSwitch.getAttribute('aria-checked')).toBe('true');
  });

  // -------------------------------------------------------------------------
  // enableCustomerJourney Switch (edit mode).
  // -------------------------------------------------------------------------
  it('renders the customerJourneySummary Switch in step 1, off by default (prefill=false)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    const sw = screen.getByRole('switch', { name: /customerJourneySummary/i }) as HTMLButtonElement;
    expect(sw).toBeDefined();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('prefills the customerJourneySummary Switch as ON when enableCustomerJourney=true', async () => {
    responder = (url, init) => {
      if (url.includes('verify-creds')) {
        return { status: 200, json: async () => ({ platform: 'meta', ok: true, message: 'תקין' }) };
      }
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => ({ ...PREFILL, enableCustomerJourney: true }) };
      }
      return { status: 200, json: async () => ({}) };
    };
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    const sw = screen.getByRole('switch', { name: /customerJourneySummary/i }) as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('toggling the Switch to ON sends enableCustomerJourney=true in the PATCH body', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    // Toggle the switch on.
    fireEvent.click(screen.getByRole('switch', { name: /customerJourneySummary/i }));
    clickNext();
    const save = screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement;
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 0));
    const patchCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && c.init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = jsonOf(patchCall!.init);
    expect(body.enableCustomerJourney).toBe(true);
  });

  it('PATCH body always includes enableCustomerJourney (false when untouched)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    clickNext();
    const save = screen.getByRole('button', { name: /שמור שינויים/ }) as HTMLButtonElement;
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 0));
    const patchCall = calls.find(
      (c) => c.url.endsWith('/api/operator/stores/mystore') && c.init?.method === 'PATCH',
    );
    const body = jsonOf(patchCall!.init);
    expect(body.enableCustomerJourney).toBe(false);
  });
});

describe('AddStoreWizard — distinct brand colour for new stores', () => {
  it('defaults a NEW store to the first palette colour NOT already used', () => {
    // The 3 live stores hold the first three palette hues → the wizard should
    // land on the 4th (var(--store-4)) so the new store is visually distinct.
    render(
      <AddStoreWizard
        onDone={vi.fn()}
        takenColors={['var(--store-uzo)', 'var(--store-usm)', 'var(--store-3)']}
      />,
    );
    const select = screen.getByLabelText(/צבע-מותג/) as HTMLSelectElement;
    expect(select.value).toBe('var(--store-4)');
  });

  it('marks already-used colours "(בשימוש)" in the picker', () => {
    render(<AddStoreWizard onDone={vi.fn()} takenColors={['var(--store-uzo)']} />);
    const select = screen.getByLabelText(/צבע-מותג/) as HTMLSelectElement;
    const usedOption = Array.from(select.options).find((o) => o.value === 'var(--store-uzo)');
    const freeOption = Array.from(select.options).find((o) => o.value === 'var(--store-4)');
    expect(usedOption?.textContent).toMatch(/בשימוש/);
    expect(freeOption?.textContent).not.toMatch(/בשימוש/);
  });

  it('with no takenColors (first store) defaults to the first palette colour', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    const select = screen.getByLabelText(/צבע-מותג/) as HTMLSelectElement;
    expect(select.value).toBe('var(--store-uzo)');
  });
});

// ---------------------------------------------------------------------------
// P1-27a + P2-43 (2026-06-10 audit) — edit-mode off-toggle lock + credential
// step focus jump.
// ---------------------------------------------------------------------------
describe('AddStoreWizard — EDIT mode platform-toggle lock (P1-27a)', () => {
  const PREFILL = {
    storeId: 'mystore',
    name: 'My Store',
    shopDomain: 'mystore.myshopify.com',
    isHeadless: false,
    brandColor: 'var(--store-uzo)',
    displayOrder: 2,
    hasTiktok: true,
    enableCustomerJourney: false,
    platforms: ['shopify', 'meta'],
    hasWebhookSecret: false,
  };

  beforeEach(() => {
    responder = (url, init) => {
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => PREFILL };
      }
      return { status: 200, json: async () => ({}) };
    };
  });

  it('disables the OFF direction for a platform already ON in the DB (Meta) with an honest hint', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    // Meta is ON server-side → its switch is checked AND disabled (the PATCH
    // would silently discard a removal — P1-27a).
    const metaSwitch = screen.getByRole('switch', { name: 'Meta' });
    expect(metaSwitch.getAttribute('data-state')).toBe('checked');
    expect((metaSwitch as HTMLButtonElement).disabled).toBe(true);
    // The honest hint renders.
    expect(screen.getByText(/הסרת פלטפורמה מחוברת אינה נתמכת/)).toBeDefined();
    // Google is OFF server-side → freely togglable.
    const googleSwitch = screen.getByRole('switch', { name: 'Google' });
    expect((googleSwitch as HTMLButtonElement).disabled).toBe(false);
    // TikTok round-trips via PATCH hasTiktok → never locked.
    const ttSwitch = screen.getByRole('switch', { name: 'TikTok' });
    expect((ttSwitch as HTMLButtonElement).disabled).toBe(false);
  });

  it('ADD mode keeps all platform toggles enabled (regression)', () => {
    render(<AddStoreWizard onDone={vi.fn()} />);
    for (const name of ['Meta', 'Google', 'TikTok']) {
      expect((screen.getByRole('switch', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.queryByText(/הסרת פלטפורמה מחוברת אינה נתמכת/)).toBeNull();
  });
});

describe('AddStoreWizard — credential-matrix focus jump (P2-43)', () => {
  const PREFILL = {
    storeId: 'mystore',
    name: 'My Store',
    shopDomain: 'mystore.myshopify.com',
    isHeadless: false,
    brandColor: 'var(--store-uzo)',
    displayOrder: 2,
    hasTiktok: false,
    enableCustomerJourney: false,
    platforms: ['shopify'],
    hasWebhookSecret: false,
  };

  beforeEach(() => {
    responder = (url, init) => {
      if (url.endsWith('/api/operator/stores/mystore') && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, json: async () => PREFILL };
      }
      return { status: 200, json: async () => ({}) };
    };
  });

  it('opens directly on the CREDENTIALS step when focusPlatform is set in edit mode', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" focusPlatform="meta" />);
    // After prefill, the wizard must land on step 2 — the Meta cred block is
    // visible WITHOUT walking through step 1 (focusPlatform pre-enables Meta).
    const metaToken = (await screen.findByLabelText(/Meta access[_ ]?token/i)) as HTMLInputElement;
    expect(metaToken.value).toBe('');
    // Step-1-only fields are NOT rendered.
    expect(screen.queryByLabelText(/שם תצוגה/)).toBeNull();
  });

  it('opens on step 1 in edit mode WITHOUT focusPlatform (regression)', async () => {
    render(<AddStoreWizard onDone={vi.fn()} editStoreId="mystore" />);
    await screen.findByDisplayValue('My Store');
    expect(screen.getByLabelText(/שם תצוגה/)).toBeDefined();
    expect(screen.queryByLabelText(/Shopify client_id/i)).toBeNull();
  });
});
