/**
 * Hermetic guard (Phase 3, Task D) — the /api/store-events READ route must:
 *   1. run on the `nodejs` runtime (it uses the service-role admin client,
 *      which is server-only and not Edge-safe), and
 *   2. stay PASSWORD-GATED — i.e. NOT be added to `isDashboardAuthAllowlisted`.
 *      Unlike the HMAC/token-authenticated ingest endpoints
 *      (`/api/webhooks/shopify`, `/api/events/cart`), the read route carries no
 *      route-level auth of its own; its only protection is the dashboard cookie.
 *      If someone ever allowlists it, `store_events` (which has no anon grant)
 *      would leak to the open internet. This guard makes that regression loud.
 *
 * Static-source checks (no DOM, no Next runtime) so the assertion can't be
 * silently defeated by a mock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDashboardAuthAllowlisted } from '../middlewareHelpers';

const ROUTE_SRC = resolve(__dirname, '..', '..', 'app', 'api', 'store-events', 'route.ts');

describe('/api/store-events guard — runtime + service-role + stays gated', () => {
  const src = readFileSync(ROUTE_SRC, 'utf8');

  it("exports runtime = 'nodejs' (service-role client is server-only)", () => {
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
  });

  it('reads through the service-role admin path (readRecentStoreEvents), not anon', () => {
    expect(src).toMatch(/readRecentStoreEvents/);
    // It must NOT import the anon client.
    expect(src).not.toMatch(/from\s+['"]@\/lib\/supabase['"]/);
  });

  it('is NOT in the dashboard-auth allowlist (must stay password-gated)', () => {
    expect(isDashboardAuthAllowlisted('/api/store-events')).toBe(false);
  });

  it('the ingest endpoints, by contrast, ARE allowlisted (route-level auth)', () => {
    // Sanity anchor: the allowlist still carries the two HMAC/token ingest
    // paths, so the read-route exclusion above is a deliberate distinction.
    expect(isDashboardAuthAllowlisted('/api/webhooks/shopify')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/events/cart')).toBe(true);
  });
});
