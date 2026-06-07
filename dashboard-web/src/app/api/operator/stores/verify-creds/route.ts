// dashboard-web/src/app/api/operator/stores/verify-creds/route.ts
// Self-serve stores Phase 6a — Task 4: live cred-probe endpoint.
//
// POST /api/operator/stores/verify-creds — a thin, DB-LESS wrapper around the
//   pure verifiers in @/lib/credVerifiers. The add-store wizard calls this to
//   live-probe a single platform's creds the operator just typed, BEFORE any DB
//   write (the actual add-store POST re-verifies server-side too — never trust
//   the client). It does NO DB work and NEVER echoes the submitted creds.
//
// Body: { platform: 'shopify' | 'meta' | 'google', creds: <platform-specific> }
//   shopify → { domain, clientId, clientSecret }
//   meta    → { token, adAccountId }
//   google  → { customerId, refreshToken }
//
// Response: 200 { platform, ok, message, currency? }.
//   - A verifier ok:false is STILL a 200 — the probe ran; the operator sees the
//     Hebrew failure message. Only a MALFORMED request (bad JSON / unknown or
//     missing platform) is a 400.
//   - On an unexpected throw → 500 { error } (generic; no secret in the body).
//
// Auth: gated upstream by middleware (dashboard cookie + operator secret) — no
//   auth here. SECURITY: a raw submitted credential is NEVER echoed/logged/
//   returned; the response carries only platform, ok, the verifier's Hebrew
//   message, and the optional reporting currency.
import { NextResponse } from 'next/server';
import { verifyShopify, verifyMeta, verifyGoogle } from '@/lib/credVerifiers';
import type { CredVerifyResult } from '@/lib/credVerifiers';
import { SHOP_DOMAIN_RE } from '@/lib/storeSecretsReader';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Platform = 'shopify' | 'meta' | 'google';

interface VerifyCredsBody {
  platform: Platform;
  creds: Record<string, unknown>;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: VerifyCredsBody;
  try {
    body = (await req.json()) as VerifyCredsBody;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const platform = typeof body.platform === 'string' ? body.platform : '';
  const creds = (body.creds ?? {}) as Record<string, unknown>;

  if (platform !== 'shopify' && platform !== 'meta' && platform !== 'google') {
    return NextResponse.json(
      { error: "platform must be one of 'shopify' | 'meta' | 'google'" },
      { status: 400 },
    );
  }

  // Fix B2 — validate the Shopify domain against the SHARED strict regex BEFORE
  // the live probe. This is the same SHOP_DOMAIN_RE the add (POST) + edit (PATCH)
  // routes enforce; without it, this probe would live-fetch an arbitrary host
  // (an operator-authenticated SSRF-shape inconsistency). A bad domain → 400, no
  // fetch. (Normalised to lowercase to match POST/PATCH which lowercase first.)
  if (platform === 'shopify') {
    const domain = String(creds.domain ?? '').trim().toLowerCase();
    if (!SHOP_DOMAIN_RE.test(domain)) {
      return NextResponse.json(
        { error: 'domain must be a single-label *.myshopify.com host' },
        { status: 400 },
      );
    }
  }

  try {
    let result: CredVerifyResult;
    switch (platform) {
      case 'shopify':
        result = await verifyShopify({
          domain: String(creds.domain ?? ''),
          clientId: String(creds.clientId ?? ''),
          clientSecret: String(creds.clientSecret ?? ''),
        });
        break;
      case 'meta':
        result = await verifyMeta({
          token: String(creds.token ?? ''),
          adAccountId: String(creds.adAccountId ?? ''),
        });
        break;
      case 'google':
        result = await verifyGoogle({
          customerId: String(creds.customerId ?? ''),
          refreshToken: String(creds.refreshToken ?? ''),
        });
        break;
    }

    // ok:false is a 200 — the probe RAN; only a malformed request is 400.
    // Response carries ONLY platform + the verifier's safe fields. NEVER the
    // submitted creds.
    return NextResponse.json(
      { platform, ok: result.ok, message: result.message, ...(result.currency ? { currency: result.currency } : {}) },
      { status: 200 },
    );
  } catch (err) {
    captureRouteError('operator/stores/verify-creds', err);
    // Generic 500 — never include the caught error (could carry a secret) in the
    // body. The real cause is captured by Sentry above.
    return NextResponse.json({ error: 'אימות החיבור נכשל' }, { status: 500 });
  }
}
