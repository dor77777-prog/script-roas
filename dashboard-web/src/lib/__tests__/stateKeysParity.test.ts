// dashboard-web/src/lib/__tests__/stateKeysParity.test.ts
//
// PARITY GUARD — cross-device state sync depends on two hand-maintained lists
// agreeing exactly:
//
//   CLIENT  — `STATE_KEYS` in `cloudSync.ts`. `pushCloudKey(key)` strips the
//             `roas-dashboard:` prefix and POSTs `{key, value}` to
//             /api/dashboard-state.
//   SERVER  — `ALLOWED_STATE_KEYS` in `dashboardStateKeys.ts`. The POST route
//             validates against this via `isAllowedStateKey`; an unknown key
//             gets a hard 400 ("unknown key") and is NEVER persisted.
//
// WHY THIS EXISTS: on 2026-06-02 the editable-COGS-% feature broke
// cross-device sync because `'roas-dashboard:cogs-settings'` was added to the
// CLIENT `STATE_KEYS` but `'cogs-settings'` was never added to the SERVER
// `ALLOWED_STATE_KEYS`. Every COGS save POSTed `{key:'cogs-settings'}` → 400 →
// the value stayed device-local and never reached Postgres. The "Keep this list
// in sync" comment was hope, not enforcement.
//
// This test makes it enforcement: any NEW synced key MUST be added to BOTH
// lists (the full `roas-dashboard:`-prefixed key in cloudSync.ts:STATE_KEYS AND
// the bare key in dashboardStateKeys.ts:ALLOWED_STATE_KEYS), or this test fails.
//
// NOTE: the test imports BOTH modules — that's fine in vitest. Production code
// must NOT make the server module (`dashboardStateKeys.ts`) import the
// browser-side `cloudSync.ts`, which would pull client-only refs into the
// server bundle. Parity is enforced here, in the test, only.

import { describe, expect, it } from 'vitest';
import { STATE_KEYS } from '../cloudSync';
import { ALLOWED_STATE_KEYS } from '../dashboardStateKeys';

// Same transform `pushCloudKey` applies before POSTing the key to the server.
const strip = (key: string) => key.replace(/^roas-dashboard:/, '');

describe('client/server state-key parity', () => {
  const clientStripped = STATE_KEYS.map(strip);
  const clientSet = new Set(clientStripped);
  const serverSet = new Set<string>(ALLOWED_STATE_KEYS);

  it('every client STATE_KEYS entry is in the server ALLOWED_STATE_KEYS', () => {
    const missingOnServer = clientStripped.filter((k) => !serverSet.has(k));
    expect(
      missingOnServer,
      `Client keys missing from server ALLOWED_STATE_KEYS (will 400 on POST → never persisted): ${missingOnServer.join(', ')}`,
    ).toEqual([]);
  });

  it('every server ALLOWED_STATE_KEYS entry is in the client STATE_KEYS', () => {
    const missingOnClient = (ALLOWED_STATE_KEYS as readonly string[]).filter(
      (k) => !clientSet.has(k),
    );
    expect(
      missingOnClient,
      `Server keys missing from client STATE_KEYS (allowed but never pushed/hydrated): ${missingOnClient.join(', ')}`,
    ).toEqual([]);
  });

  it('the two lists are exactly equal as sets', () => {
    expect([...clientSet].sort()).toEqual([...serverSet].sort());
  });
});
