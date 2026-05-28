import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// operatorClient unit tests
//
// Tests the localStorage-backed helpers and the operatorFetch wrapper.
// Runs in Node environment (vitest.config.ts default) with manual stubs
// for window.localStorage and global fetch — no jsdom required since we
// are testing pure module logic, not DOM rendering.
// ---------------------------------------------------------------------------

// ---- localStorage stub ----
// We simulate window.localStorage using a plain object so the tests run in
// the Node environment without jsdom. The module checks
// `typeof window === 'undefined'` first; we provide a minimal window stub.
const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
};

// Provide window.localStorage in the global scope so the module thinks it's
// running in a browser context.
vi.stubGlobal('window', {
  localStorage: localStorageMock,
});

// ---- fetch stub ----
const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

// Import AFTER stubs are in place
import {
  OPERATOR_SECRET_STORAGE_KEY,
  getOperatorSecret,
  setOperatorSecret,
  operatorFetch,
} from '../operatorClient';

describe('OPERATOR_SECRET_STORAGE_KEY', () => {
  it('is a non-empty string', () => {
    expect(typeof OPERATOR_SECRET_STORAGE_KEY).toBe('string');
    expect(OPERATOR_SECRET_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});

describe('setOperatorSecret / getOperatorSecret', () => {
  beforeEach(() => {
    // Clear the store before each test
    for (const key of Object.keys(localStorageStore)) {
      delete localStorageStore[key];
    }
  });

  it('stores a secret and retrieves it', () => {
    setOperatorSecret('my-test-secret');
    expect(getOperatorSecret()).toBe('my-test-secret');
  });

  it('returns null when nothing is stored', () => {
    expect(getOperatorSecret()).toBeNull();
  });

  it('setOperatorSecret(null) removes the stored key', () => {
    setOperatorSecret('temporary-secret');
    expect(getOperatorSecret()).toBe('temporary-secret');

    setOperatorSecret(null);
    expect(getOperatorSecret()).toBeNull();
  });

  it('overwriting replaces the previous secret', () => {
    setOperatorSecret('first-secret');
    setOperatorSecret('second-secret');
    expect(getOperatorSecret()).toBe('second-secret');
  });
});

describe('operatorFetch', () => {
  beforeEach(() => {
    // Clear localStorage
    for (const key of Object.keys(localStorageStore)) {
      delete localStorageStore[key];
    }
    fetchMock.mockClear();
  });

  it('omits x-operator-secret header when localStorage is empty', async () => {
    await operatorFetch('/api/operator/jobs');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    expect(headers.get('x-operator-secret')).toBeNull();
  });

  it('sends x-operator-secret header when localStorage has the secret', async () => {
    setOperatorSecret('test-secret-value');

    await operatorFetch('/api/operator/sync-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    expect(headers.get('x-operator-secret')).toBe('test-secret-value');
  });

  it('preserves existing headers from init when injecting the secret', async () => {
    setOperatorSecret('my-secret');

    await operatorFetch('/api/operator/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get('x-operator-secret')).toBe('my-secret');
  });

  it('passes through body and method unchanged', async () => {
    setOperatorSecret('secret');
    const body = JSON.stringify({ scope: 'store', storeId: 'uzoshop' });

    await operatorFetch('/api/operator/sync-now', {
      method: 'POST',
      body,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/operator/sync-now');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
  });

  it('does not add the secret header when secret is empty string in localStorage', async () => {
    // Edge case: if somehow an empty string was stored, treat as no secret
    localStorageStore[OPERATOR_SECRET_STORAGE_KEY] = '';

    await operatorFetch('/api/operator/jobs');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    // getOperatorSecret() returns '' which is falsy — header should not be set
    expect(headers.get('x-operator-secret')).toBeNull();
  });
});
