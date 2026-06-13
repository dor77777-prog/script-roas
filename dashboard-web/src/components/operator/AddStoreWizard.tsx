'use client';

// dashboard-web/src/components/operator/AddStoreWizard.tsx
//
// Self-serve stores Phase 6a — Task 5: the add-store wizard (also the scaffold
// for edit/T8). A 3-step client flow on the internal /operator console:
//
//   Step 1 — basics:   storeId (slug), name, shopDomain, themed/headless,
//                       brand-color, displayOrder, platform toggles (Meta /
//                       Google / TikTok). TikTok only sets hasTiktok (no creds).
//   Step 2 — creds:     paste fields per relevant platform (Shopify always;
//                       Meta/Google when toggled). A per-platform "בדוק" live-
//                       probes /verify-creds; Create is GATED on every required
//                       platform showing ✓ (with a "שמור בכל זאת" override).
//   Step 3 — success:   the storefront snippet (generateStoreSnippet) + the
//                       irreducible operator checklist. "סיום" → onDone().
//
// Design-system contract (operator-locked, build-to-standard-from-start):
//   - Token-driven only — every colour comes from the mesh tokens (glass / ink /
//     accent / status / band). NO raw hex/px colour literals (design-color guard).
//   - Light AND dark first-class (tokens flip automatically).
//   - Composed from the shared primitives (Button / Input / NativeSelect /
//     Switch / Card / Typography) — no hand-rolled inputs.
//   - RTL Hebrew copy; numeric/identifier fields override dir="ltr".
//   - Mobile-first: single-column stack, scales to 2-up on sm+.
//
// SECURITY: a raw secret is NEVER echoed back from the create response — only
// the masked confirmations + the cart routing token are surfaced. The component
// holds the typed creds in local state only to POST them once; they are never
// rendered back after submit.
//
// Contracts (locked — see route.ts / verify-creds/route.ts):
//   - POST /api/operator/stores  → 201 { ok, store, secretsSet, secretsMasked,
//       cartPublicToken } | 400 { error, verification? } | 409 { error } |
//       500 { error, code }.
//   - POST /api/operator/stores/verify-creds → 200 { platform, ok, message,
//       currency? } (only a malformed request is 400).
//   - PATCH /api/operator/stores/{id} — edit (route lands in T8). The edit path
//       here is a lightweight scaffold; T8 completes prefill + its DOM test.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Copy, Loader2 } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { generateStoreSnippet } from '@/lib/storeSnippets';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Switch } from '@/components/ui/Switch';
import { Card } from '@/components/ui/Card';
import { Heading, Text } from '@/components/ui/Typography';

// ---------------------------------------------------------------------------
// Validation — mirrors the server constants so the inline error fires BEFORE a
// round-trip. The server re-validates (defense in depth); a slug that slips
// past here (e.g. uniqueness) is surfaced via the 409 on Create.
// ---------------------------------------------------------------------------
const STORE_ID_RE = /^[a-z0-9_-]+$/;
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const RESERVED_SLUGS = new Set(['__global__']);

// Brand-color choices — token-driven swatches. Values are CSS-var strings
// (the same shape the live stores already store, e.g. "var(--store-uzo)"),
// so the home cards' colour pipeline consumes a net-new store identically.
// Each carries a Hebrew label; the swatch preview uses the var directly (no
// raw colour literal → design-color guard passes).
const BRAND_COLORS: Array<{ value: string; label: string }> = [
  { value: 'var(--store-uzo)', label: 'תכלת' },
  { value: 'var(--store-usm)', label: 'ורוד' },
  { value: 'var(--store-3)', label: 'ירוק' },
  { value: 'var(--store-4)', label: 'סגול' },
  { value: 'var(--store-5)', label: 'ענבר' },
  { value: 'var(--store-6)', label: 'אינדיגו' },
  { value: 'var(--store-7)', label: 'אלמוג' },
  { value: 'var(--store-8)', label: 'טורקיז' },
];

/** Normalise a brand-colour string for set membership (trim + collapse ws). */
function normColor(c: string | null | undefined): string {
  return (c ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Pick the default brand colour for a NEW store: the first palette colour NOT
 * already used by an existing store, so each store lands on a distinct hue. If
 * every palette colour is taken (more stores than swatches) we fall back to the
 * first — the operator can still override, and "(בשימוש)" marks the clash.
 */
function firstFreeColor(taken: readonly string[]): string {
  const used = new Set(taken.map(normColor));
  return (BRAND_COLORS.find((c) => !used.has(normColor(c.value))) ?? BRAND_COLORS[0]).value;
}

type Platform = 'shopify' | 'meta' | 'google';
type VerifyState = { ok: boolean; message: string } | null;

interface Step1State {
  storeId: string;
  name: string;
  shopDomain: string;
  isHeadless: boolean;
  brandColor: string;
  displayOrder: string; // string so the field can be empty (server defaults)
  hasMeta: boolean;
  hasGoogle: boolean;
  hasTiktok: boolean;
  enableCustomerJourney: boolean;
}

interface Step2State {
  shopifyClientId: string;
  shopifyClientSecret: string;
  // OPERATOR-ENTERED Shopify webhook signing secret (D3 / Fix B1). NOT the
  // client_secret — it's the shop-level secret Shopify shows when you register
  // the order/refund webhook. Sent as `webhookSecret`. Never prefilled in edit;
  // the wizard only shows a "מוגדר / לא מוגדר" status from hasWebhookSecret.
  webhookSecret: string;
  metaToken: string;
  metaAdAccountId: string;
  googleCustomerId: string;
  googleRefreshToken: string;
}

/** Credential-matrix focus targets (mirrors StoreList.ManageFocus). */
export type FocusPlatform = 'shopify' | 'meta' | 'google' | 'tiktok' | 'webhook';

interface CreatedStore {
  storeId: string;
  cartPublicToken: string;
  isHeadless: boolean;
  secretsMasked?: Record<string, string>;
}

export interface AddStoreWizardProps {
  onDone: () => void;
  /** When set the wizard runs in EDIT mode → PATCH /api/operator/stores/{id}. */
  editStoreId?: string;
  /**
   * D3 — credential-matrix focus. In EDIT mode, when set the wizard pre-enables
   * that platform's toggle (for a currently-off ad platform / TikTok) and
   * highlights its creds section; for 'webhook' it focuses the webhook field.
   * Ignored in ADD mode.
   */
  focusPlatform?: FocusPlatform;
  /**
   * Brand colours already used by OTHER stores. In ADD mode the wizard defaults
   * to the first palette colour NOT in this list (so each new store gets a
   * distinct hue) and marks the used ones "(בשימוש)". Excludes the store being
   * edited so its own colour never reads as taken. Defaults to [] (no clashes).
   */
  takenColors?: readonly string[];
}

const EMPTY_STEP1: Step1State = {
  storeId: '',
  name: '',
  shopDomain: '',
  isHeadless: false,
  brandColor: BRAND_COLORS[0].value,
  displayOrder: '',
  hasMeta: false,
  hasGoogle: false,
  hasTiktok: false,
  enableCustomerJourney: false,
};

const EMPTY_STEP2: Step2State = {
  shopifyClientId: '',
  shopifyClientSecret: '',
  webhookSecret: '',
  metaToken: '',
  metaAdAccountId: '',
  googleCustomerId: '',
  googleRefreshToken: '',
};

export function AddStoreWizard({
  onDone,
  editStoreId,
  focusPlatform,
  takenColors = [],
}: AddStoreWizardProps) {
  const isEdit = typeof editStoreId === 'string' && editStoreId.length > 0;

  // Colours already used by other stores → mark "(בשימוש)" + steer the default
  // off them. Frozen at mount (taken set doesn't change while the wizard is open).
  const usedColors = useMemo(() => new Set(takenColors.map(normColor)), [takenColors]);

  // P2-43 (2026-06-10 audit): a credential-matrix "חבר/החלף" click passes
  // focusPlatform — land the operator directly on the CREDENTIALS step (the
  // highlighted block scroll/autofocus already lives in Step2) instead of
  // making them re-walk the basics step.
  const [step, setStep] = useState<1 | 2 | 3>(isEdit && focusPlatform ? 2 : 1);
  const [s1, setS1] = useState<Step1State>(() =>
    isEdit
      ? { ...EMPTY_STEP1, storeId: editStoreId! }
      : { ...EMPTY_STEP1, brandColor: firstFreeColor(takenColors) },
  );
  const [s2, setS2] = useState<Step2State>(EMPTY_STEP2);

  const [slugError, setSlugError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);

  const [verify, setVerify] = useState<Record<Platform, VerifyState>>({
    shopify: null,
    meta: null,
    google: null,
  });
  const [verifying, setVerifying] = useState<Record<Platform, boolean>>({
    shopify: false,
    meta: false,
    google: false,
  });
  const [saveAnyway, setSaveAnyway] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedStore | null>(null);

  // Edit mode: prefill step-1 basics from GET /api/operator/stores/{id}. The
  // GET returns BASICS ONLY — never a secret — so the step-2 cred fields stay
  // EMPTY (leave-empty-to-keep semantics). `prefilling` shows a loading state.
  const [prefilling, setPrefilling] = useState(isEdit);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  // D3 — the webhook signing-secret PRESENCE (from GET hasWebhookSecret). Drives
  // the "מוגדר / לא מוגדר" status in edit; the raw value is NEVER prefilled.
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  // P1-27a (2026-06-10 audit): the server-side ON state per ad platform. The
  // PATCH payload carries no hasMeta/hasGoogle, and the server only ADDs
  // newly-credentialed platforms — so toggling an existing platform OFF was a
  // SILENT no-op. We lock the off-direction for these (honest > discard).
  const [serverPlatforms, setServerPlatforms] = useState<Platform[]>([]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      setPrefilling(true);
      setPrefillError(null);
      try {
        const res = await operatorFetch(`/api/operator/stores/${editStoreId}`);
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          storeId?: string;
          name?: string;
          shopDomain?: string;
          isHeadless?: boolean;
          brandColor?: string | null;
          displayOrder?: number | null;
          hasTiktok?: boolean;
          enableCustomerJourney?: boolean;
          platforms?: string[];
          hasWebhookSecret?: boolean;
        };
        if (res.status >= 400) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        const platforms = (body.platforms ?? []) as Platform[];
        setServerPlatforms(platforms);
        setHasWebhookSecret(body.hasWebhookSecret === true);
        setS1((s) => ({
          ...s,
          storeId: editStoreId!,
          name: body.name ?? '',
          shopDomain: body.shopDomain ?? '',
          isHeadless: body.isHeadless === true,
          brandColor: body.brandColor ?? s.brandColor,
          displayOrder: body.displayOrder == null ? '' : String(body.displayOrder),
          // D3 — focusPlatform pre-enables a currently-OFF ad platform / TikTok so
          // the operator lands ready to add it. An already-on platform stays on.
          hasMeta: platforms.includes('meta') || focusPlatform === 'meta',
          hasGoogle: platforms.includes('google') || focusPlatform === 'google',
          hasTiktok: body.hasTiktok === true || focusPlatform === 'tiktok',
          enableCustomerJourney: body.enableCustomerJourney === true,
        }));
      } catch (e) {
        if (!cancelled) setPrefillError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPrefilling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, editStoreId, focusPlatform]);

  // -------------------------------------------------------------------------
  // Step 1 → Step 2 gate (client validation).
  // -------------------------------------------------------------------------
  function validateStep1(): boolean {
    let ok = true;
    const slug = s1.storeId.trim();
    if (!STORE_ID_RE.test(slug)) {
      setSlugError('המזהה חייב להיות אותיות קטנות, ספרות, מקף או קו-תחתון בלבד');
      ok = false;
    } else if (RESERVED_SLUGS.has(slug)) {
      setSlugError('המזהה הזה שמור');
      ok = false;
    } else {
      setSlugError(null);
    }

    const domain = s1.shopDomain.trim().toLowerCase();
    if (!SHOP_DOMAIN_RE.test(domain)) {
      setDomainError('דומיין חייב להיות בצורת shop.myshopify.com');
      ok = false;
    } else {
      setDomainError(null);
    }

    if (!s1.name.trim()) {
      setNameError('שם תצוגה נדרש');
      ok = false;
    } else {
      setNameError(null);
    }

    return ok;
  }

  function goToStep2() {
    if (!validateStep1()) return;
    setStep(2);
  }

  // -------------------------------------------------------------------------
  // Per-platform live verify.
  // -------------------------------------------------------------------------
  function credsFor(platform: Platform): Record<string, string> {
    switch (platform) {
      case 'shopify':
        return {
          domain: s1.shopDomain.trim().toLowerCase(),
          clientId: s2.shopifyClientId,
          clientSecret: s2.shopifyClientSecret,
        };
      case 'meta':
        return { token: s2.metaToken, adAccountId: s2.metaAdAccountId };
      case 'google':
        return { customerId: s2.googleCustomerId, refreshToken: s2.googleRefreshToken };
    }
  }

  async function runVerify(platform: Platform) {
    setVerifying((v) => ({ ...v, [platform]: true }));
    try {
      const res = await operatorFetch('/api/operator/stores/verify-creds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, creds: credsFor(platform) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (res.status >= 400) {
        setVerify((v) => ({ ...v, [platform]: { ok: false, message: body.error ?? `HTTP ${res.status}` } }));
      } else {
        setVerify((v) => ({
          ...v,
          [platform]: { ok: body.ok === true, message: body.message ?? '' },
        }));
      }
    } catch (e) {
      setVerify((v) => ({
        ...v,
        [platform]: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setVerifying((v) => ({ ...v, [platform]: false }));
    }
  }

  // -------------------------------------------------------------------------
  // Stale-✓ reset — whenever a credential for a platform changes the prior
  // verify result is for the OLD creds, so we clear it (re-disabling Create
  // until a fresh ✓, unless "save anyway" is on). A change to step-1's
  // shopDomain is also a Shopify-cred change (the domain is part of the probe).
  // -------------------------------------------------------------------------
  function clearVerify(platform: Platform) {
    setVerify((v) => (v[platform] === null ? v : { ...v, [platform]: null }));
  }

  function setCred(platform: Platform, patch: Partial<Step2State>) {
    setS2((s) => ({ ...s, ...patch }));
    clearVerify(platform);
  }

  // Step-1 shopDomain change → mutate s1 AND invalidate the Shopify verify
  // (the domain is part of the Shopify probe).
  function setShopDomain(value: string) {
    setS1((s) => ({ ...s, shopDomain: value }));
    clearVerify('shopify');
  }

  // Toggling a platform off/on must drop any stale ✓ for it so re-checking
  // requires a fresh verify (and an off platform's ✓ never lingers in state).
  function setHasMeta(v: boolean) {
    setS1((s) => ({ ...s, hasMeta: v }));
    clearVerify('meta');
  }
  function setHasGoogle(v: boolean) {
    setS1((s) => ({ ...s, hasGoogle: v }));
    clearVerify('google');
  }

  // A platform is "rotated" when its cred fields are filled. In EDIT mode an
  // untouched (empty) platform keeps its existing secret and needs NO verify;
  // only a rotated platform requires a fresh ✓. In ADD mode Shopify is always
  // required and Meta/Google are required when toggled on.
  function isRotated(platform: Platform): boolean {
    switch (platform) {
      case 'shopify':
        return s2.shopifyClientId.trim() !== '' || s2.shopifyClientSecret.trim() !== '';
      case 'meta':
        return s2.metaToken.trim() !== '' || s2.metaAdAccountId.trim() !== '';
      case 'google':
        return s2.googleCustomerId.trim() !== '' || s2.googleRefreshToken.trim() !== '';
    }
  }

  // Required-✓ platforms.
  //   ADD:  Shopify always + Meta-if-checked + Google-if-checked.
  //   EDIT: ONLY the platforms the operator chose to rotate (filled fields).
  const requiredPlatforms: Platform[] = isEdit
    ? (['shopify', 'meta', 'google'] as Platform[]).filter(isRotated)
    : (() => {
        const req: Platform[] = ['shopify'];
        if (s1.hasMeta) req.push('meta');
        if (s1.hasGoogle) req.push('google');
        return req;
      })();

  // Gate ONLY on currently-required platforms — a stale ✓ for a platform that
  // is no longer checked must never count, and re-checking a platform requires
  // a fresh ✓ (its verify entry was cleared on toggle-off). In edit mode with
  // no platform rotated, requiredPlatforms is empty → every() is vacuously true,
  // so a basics-only edit can save without any verify.
  const allVerified = requiredPlatforms.every((p) => verify[p]?.ok === true);
  const canCreate = (allVerified || saveAnyway) && !submitting;

  // -------------------------------------------------------------------------
  // Create (POST) / Edit (PATCH) submit.
  // -------------------------------------------------------------------------
  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const displayOrderNum = s1.displayOrder.trim() === '' ? undefined : Number(s1.displayOrder);
      const payload: Record<string, unknown> = isEdit
        ? {
            // EDIT (PATCH): basics always; the id comes from the URL path, NOT
            // the body. Cred objects are included ONLY for rotated platforms
            // (filled fields) — an untouched platform keeps its existing secret.
            name: s1.name.trim(),
            shopDomain: s1.shopDomain.trim().toLowerCase(),
            isHeadless: s1.isHeadless,
            brandColor: s1.brandColor,
            hasTiktok: s1.hasTiktok,
            enableCustomerJourney: s1.enableCustomerJourney,
          }
        : {
            // ADD (POST): full creation payload (Shopify creds always required).
            storeId: s1.storeId.trim(),
            name: s1.name.trim(),
            shopDomain: s1.shopDomain.trim().toLowerCase(),
            isHeadless: s1.isHeadless,
            brandColor: s1.brandColor,
            hasTiktok: s1.hasTiktok,
            shopify: { clientId: s2.shopifyClientId, clientSecret: s2.shopifyClientSecret },
          };
      if (displayOrderNum !== undefined && Number.isFinite(displayOrderNum)) {
        payload.displayOrder = displayOrderNum;
      }
      // D3 — operator-entered webhook signing secret. Sent (top-level) whenever
      // the field is non-empty, in BOTH add + edit. Empty → omitted (edit keeps
      // the existing secret; add leaves signing_secret null). NEVER prefilled.
      const webhookSecretTrimmed = s2.webhookSecret.trim();
      if (webhookSecretTrimmed !== '') {
        payload.webhookSecret = webhookSecretTrimmed;
      }
      if (isEdit) {
        // Only rotated platforms (filled fields) → full cred set each.
        if (isRotated('shopify')) {
          payload.shopify = { clientId: s2.shopifyClientId, clientSecret: s2.shopifyClientSecret };
        }
        if (isRotated('meta')) payload.meta = { token: s2.metaToken, adAccountId: s2.metaAdAccountId };
        if (isRotated('google')) {
          payload.google = { customerId: s2.googleCustomerId, refreshToken: s2.googleRefreshToken };
        }
      } else {
        if (s1.hasMeta) payload.meta = { token: s2.metaToken, adAccountId: s2.metaAdAccountId };
        if (s1.hasGoogle) {
          payload.google = { customerId: s2.googleCustomerId, refreshToken: s2.googleRefreshToken };
        }
      }

      const url = isEdit ? `/api/operator/stores/${editStoreId}` : '/api/operator/stores';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await operatorFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        store?: { storeId?: string };
        cartPublicToken?: string;
        secretsMasked?: Record<string, string>;
        verification?: Record<string, string>;
      };
      if (res.status >= 400) {
        const verifMsg = body.verification
          ? ' — ' + Object.values(body.verification).join(' · ')
          : '';
        throw new Error((body.error ?? `HTTP ${res.status}`) + verifMsg);
      }
      if (isEdit) {
        // Edit has no snippet/checklist success screen — the store already
        // exists. On a successful PATCH return to the list (StoresTab refetches).
        onDone();
        return;
      }
      setCreated({
        storeId: body.store?.storeId ?? s1.storeId.trim(),
        cartPublicToken: body.cartPublicToken ?? '',
        isHeadless: s1.isHeadless,
        secretsMasked: body.secretsMasked,
      });
      setStep(3);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <Card className="max-w-3xl">
      <Heading level="hero" className="mb-1">
        {isEdit ? 'עריכת חנות' : 'הוספת חנות חדשה'}
      </Heading>
      <StepDots step={step} />

      {prefilling && (
        <Text as="p" tone="muted" role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          טוען פרטי חנות…
        </Text>
      )}

      {prefillError && (
        <Text as="p" role="alert" className="mb-3 text-sm text-status-redFg">
          טעינת פרטי החנות נכשלה — {prefillError}
        </Text>
      )}

      {!prefilling && step === 1 && (
        <Step1
          s1={s1}
          setS1={setS1}
          setShopDomain={setShopDomain}
          setHasMeta={setHasMeta}
          setHasGoogle={setHasGoogle}
          slugError={slugError}
          nameError={nameError}
          domainError={domainError}
          isEdit={isEdit}
          // P1-27a — lock the OFF direction for platforms already on in the DB
          // (PATCH would silently discard the removal).
          lockedOnMeta={isEdit && serverPlatforms.includes('meta')}
          lockedOnGoogle={isEdit && serverPlatforms.includes('google')}
          usedColors={usedColors}
          onNext={goToStep2}
          onCancel={onDone}
        />
      )}

      {!prefilling && step === 2 && (
        <Step2
          s1={s1}
          s2={s2}
          setCred={setCred}
          setWebhookSecret={(v) => setS2((s) => ({ ...s, webhookSecret: v }))}
          hasWebhookSecret={hasWebhookSecret}
          focusPlatform={focusPlatform}
          verify={verify}
          verifying={verifying}
          runVerify={runVerify}
          saveAnyway={saveAnyway}
          setSaveAnyway={setSaveAnyway}
          canCreate={canCreate}
          submitting={submitting}
          submitError={submitError}
          isEdit={isEdit}
          onBack={() => setStep(1)}
          onSubmit={submit}
        />
      )}

      {step === 3 && created && <Step3 created={created} onDone={onDone} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step dots — tiny progress affordance (token-driven, both themes).
// ---------------------------------------------------------------------------
function StepDots({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['פרטים', 'טוקנים', 'סיום'];
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="שלבי האשף">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={
                'flex h-6 w-6 items-center justify-center rounded-full text-2xs font-semibold ' +
                (active
                  ? 'bg-accent text-accent-fg'
                  : done
                    ? 'bg-status-greenBg text-status-greenFg'
                    : 'bg-glass-2 text-ink-muted')
              }
            >
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <Text as="span" tone={active ? 'default' : 'muted'} className="text-xs">
              {label}
            </Text>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Reusable labelled field — keeps every input wired to a <label htmlFor> so
// getByLabelText works + AT announces the field.
// ---------------------------------------------------------------------------
function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-secondary">
        {label}
      </label>
      {children}
      {hint && (
        <Text as="p" tone="muted" className="mt-1 text-2xs">
          {hint}
        </Text>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — basics.
// ---------------------------------------------------------------------------
function Step1({
  s1,
  setS1,
  setShopDomain,
  setHasMeta,
  setHasGoogle,
  slugError,
  nameError,
  domainError,
  isEdit,
  lockedOnMeta = false,
  lockedOnGoogle = false,
  usedColors,
  onNext,
  onCancel,
}: {
  s1: Step1State;
  setS1: React.Dispatch<React.SetStateAction<Step1State>>;
  setShopDomain: (value: string) => void;
  setHasMeta: (v: boolean) => void;
  setHasGoogle: (v: boolean) => void;
  slugError: string | null;
  nameError: string | null;
  domainError: string | null;
  isEdit: boolean;
  /** P1-27a — platform is ON in the DB; PATCH can't remove it, so the
   *  off-direction is disabled with an honest hint instead of a silent no-op. */
  lockedOnMeta?: boolean;
  lockedOnGoogle?: boolean;
  /** Normalised brand colours used by OTHER stores → mark "(בשימוש)". */
  usedColors: Set<string>;
  onNext: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <Field id="store-slug" label="מזהה (slug)">
        <Input
          id="store-slug"
          dir="ltr"
          value={s1.storeId}
          disabled={isEdit}
          onChange={(e) => setS1((s) => ({ ...s, storeId: e.target.value }))}
          placeholder="glowlab"
          error={slugError ?? undefined}
        />
      </Field>

      <Field id="store-name" label="שם תצוגה">
        <Input
          id="store-name"
          value={s1.name}
          onChange={(e) => setS1((s) => ({ ...s, name: e.target.value }))}
          placeholder="Glow Lab"
          error={nameError ?? undefined}
        />
      </Field>

      <Field id="store-domain" label="דומיין Shopify">
        <Input
          id="store-domain"
          dir="ltr"
          value={s1.shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          placeholder="glowlab.myshopify.com"
          error={domainError ?? undefined}
        />
      </Field>

      {/* Themed vs headless */}
      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-ink-secondary">סוג חנות</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <Switch
              aria-label="Headless (Lovable)"
              checked={s1.isHeadless}
              onCheckedChange={(v) => setS1((s) => ({ ...s, isHeadless: v }))}
            />
            {s1.isHeadless ? 'Headless (Lovable)' : 'Themed (תבנית Shopify)'}
          </label>
        </div>
      </div>

      {/* Brand color — each store gets a distinct hue. Colours already used by
          other stores are marked "· בשימוש" and the default lands on a free one. */}
      <Field
        id="store-brand"
        label="צבע-מותג"
        hint="כל חנות בצבע משלה — הצבעים שכבר בשימוש מסומנים «בשימוש»."
      >
        <NativeSelect
          id="store-brand"
          value={s1.brandColor}
          onChange={(e) => setS1((s) => ({ ...s, brandColor: e.target.value }))}
        >
          {BRAND_COLORS.map((c) => {
            const taken = usedColors.has(normColor(c.value));
            return (
              <option key={c.value} value={c.value}>
                {taken ? `${c.label} · בשימוש` : c.label}
              </option>
            );
          })}
        </NativeSelect>
        <div className="mt-2 flex items-center gap-2" aria-hidden="true">
          {BRAND_COLORS.map((c) => {
            const taken = usedColors.has(normColor(c.value));
            return (
              <span
                key={c.value}
                className={
                  'h-5 w-5 rounded-md border border-glass-edge ' +
                  (c.value === s1.brandColor ? 'ring-2 ring-accent ' : '') +
                  (taken && c.value !== s1.brandColor ? 'opacity-40' : '')
                }
                style={{ background: c.value }}
              />
            );
          })}
        </div>
      </Field>

      <Field
        id="store-order"
        label="סדר תצוגה (אופציונלי)"
        hint="ריק = יתווסף בסוף אוטומטית"
      >
        <Input
          id="store-order"
          type="number"
          dir="ltr"
          className="w-28"
          value={s1.displayOrder}
          onChange={(e) => setS1((s) => ({ ...s, displayOrder: e.target.value }))}
          placeholder="auto"
        />
      </Field>

      {/* Platform toggles. P1-27a: a platform already ON in the DB can't be
          toggled OFF here (PATCH has no removal path — it would be silently
          discarded), so the off-direction is disabled with a hint. TikTok's
          hasTiktok DOES round-trip, so it stays freely togglable. */}
      <div className="mb-4">
        <span className="mb-2 block text-xs font-medium text-ink-secondary">פלטפורמות פעילות</span>
        <div className="flex flex-wrap gap-2">
          <PlatformToggle
            label="Meta"
            checked={s1.hasMeta}
            onChange={setHasMeta}
            disabled={lockedOnMeta && s1.hasMeta}
          />
          <PlatformToggle
            label="Google"
            checked={s1.hasGoogle}
            onChange={setHasGoogle}
            disabled={lockedOnGoogle && s1.hasGoogle}
          />
          <PlatformToggle
            label="TikTok"
            note="(חשבון משותף)"
            checked={s1.hasTiktok}
            onChange={(v) => setS1((s) => ({ ...s, hasTiktok: v }))}
          />
        </div>
        {((lockedOnMeta && s1.hasMeta) || (lockedOnGoogle && s1.hasGoogle)) && (
          <Text as="p" tone="muted" className="mt-1.5 text-2xs">
            הסרת פלטפורמה מחוברת אינה נתמכת עדיין מהממשק — פנה ל-DB.
          </Text>
        )}
      </div>

      {/* Advanced — Shopify customerJourneySummary gap-fill */}
      <div className="mb-4">
        <span className="mb-2 block text-xs font-medium text-ink-secondary">מתקדם</span>
        <label className="flex items-start gap-3 rounded-lg border border-glass-edge bg-glass-2 p-3 text-sm text-ink">
          <Switch
            aria-label="שאיבת מסע-לקוח מ-Shopify (customerJourneySummary)"
            checked={s1.enableCustomerJourney}
            onCheckedChange={(v) => setS1((s) => ({ ...s, enableCustomerJourney: v }))}
            className="mt-0.5 shrink-0"
          />
          <span>
            <span className="block font-medium">שאיבת מסע-לקוח מ-Shopify (customerJourneySummary)</span>
            <Text as="span" tone="muted" className="mt-0.5 block text-2xs">
              ייחוס עשיר יותר לקמפיינים — הפעל רק אחרי אישור Protected Customer Data ב-Shopify
            </Text>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onNext}>
          הבא ←
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

function PlatformToggle({
  label,
  note,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** P1-27a — true when the toggle's only legal direction (off) is unsupported. */
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-glass-edge bg-glass-2 px-3 py-1.5 text-sm text-ink">
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      {label}
      {note && (
        <Text as="span" tone="muted" className="text-2xs">
          {note}
        </Text>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — credentials + per-platform verify gating.
// ---------------------------------------------------------------------------
function Step2({
  s1,
  s2,
  setCred,
  setWebhookSecret,
  hasWebhookSecret,
  focusPlatform,
  verify,
  verifying,
  runVerify,
  saveAnyway,
  setSaveAnyway,
  canCreate,
  submitting,
  submitError,
  isEdit,
  onBack,
  onSubmit,
}: {
  s1: Step1State;
  s2: Step2State;
  setCred: (platform: Platform, patch: Partial<Step2State>) => void;
  setWebhookSecret: (v: string) => void;
  hasWebhookSecret: boolean;
  focusPlatform?: FocusPlatform;
  verify: Record<Platform, VerifyState>;
  verifying: Record<Platform, boolean>;
  runVerify: (p: Platform) => void;
  saveAnyway: boolean;
  setSaveAnyway: (v: boolean) => void;
  canCreate: boolean;
  submitting: boolean;
  submitError: string | null;
  isEdit: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  // In edit mode the cred fields start EMPTY — a placeholder says leaving them
  // blank keeps the existing secret; only filling them rotates (and re-verifies).
  const keep = 'השאר ריק כדי לשמור את הקיים';
  const ph = (add: string) => (isEdit ? keep : add);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onSubmit();
      }}
    >
      <Text as="p" tone="muted" className="mb-4 text-xs">
        {isEdit
          ? 'מלא רק את הפלטפורמות שברצונך להחליף את הטוקנים שלהן. שדה ריק = הטוקן הקיים נשמר. ה-"בדוק" מאמת חי לפני השמירה.'
          : 'הדבק את הטוקנים. ה-"בדוק" מאמת חי מול הספק לפני יצירת החנות. הטוקנים נשמרים מוצפנים — לעולם לא מוחזרים גלויים.'}
      </Text>

      {/* Shopify — always */}
      <PlatformCredBlock
        title="Shopify"
        verifyState={verify.shopify}
        verifying={verifying.shopify}
        onVerify={() => runVerify('shopify')}
        highlight={focusPlatform === 'shopify' || focusPlatform === 'webhook'}
      >
        <Field id="cred-shop-id" label="Shopify client_id">
          <Input
            id="cred-shop-id"
            dir="ltr"
            value={s2.shopifyClientId}
            onChange={(e) => setCred('shopify', { shopifyClientId: e.target.value })}
            placeholder={ph('paste')}
          />
        </Field>
        <Field id="cred-shop-secret" label="Shopify client_secret">
          <Input
            id="cred-shop-secret"
            dir="ltr"
            type="password"
            value={s2.shopifyClientSecret}
            onChange={(e) => setCred('shopify', { shopifyClientSecret: e.target.value })}
            placeholder={ph('paste')}
          />
        </Field>

        {/* D3 — Webhook signing secret. SHOP-LEVEL secret (NOT the Client
            Secret). In edit mode we show a presence status + a "החלף" affordance;
            the value is NEVER prefilled. focusPlatform='webhook' autofocuses it. */}
        <Field
          id="cred-webhook-secret"
          label="סוד חתימת Webhook"
          hint="הדבק את ה-signing secret ש-Shopify מציג כשאתה רושם את ה-webhook (Settings → Notifications → Webhooks, או ב-custom app). לא ה-Client Secret."
        >
          {isEdit && (
            <Text as="p" tone="muted" className="mb-1 text-2xs">
              סטטוס נוכחי:{' '}
              <span className={hasWebhookSecret ? 'text-status-greenFg' : 'text-status-warningFg'}>
                {hasWebhookSecret ? 'מוגדר' : 'לא מוגדר'}
              </span>
              {hasWebhookSecret ? ' — הזן ערך חדש כדי להחליף' : ' — הדבק כדי להפעיל את הפיד בזמן-אמת'}
            </Text>
          )}
          <Input
            id="cred-webhook-secret"
            dir="ltr"
            type="password"
            autoFocus={focusPlatform === 'webhook'}
            value={s2.webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={isEdit ? (hasWebhookSecret ? 'מוגדר — השאר ריק לשמירה' : 'paste') : 'paste'}
          />
        </Field>
      </PlatformCredBlock>

      {/* Meta — if checked */}
      {s1.hasMeta && (
        <PlatformCredBlock
          title="Meta"
          verifyState={verify.meta}
          verifying={verifying.meta}
          onVerify={() => runVerify('meta')}
          highlight={focusPlatform === 'meta'}
        >
          <Field id="cred-meta-token" label="Meta access_token">
            <Input
              id="cred-meta-token"
              dir="ltr"
              type="password"
              value={s2.metaToken}
              onChange={(e) => setCred('meta', { metaToken: e.target.value })}
              placeholder={ph('paste')}
            />
          </Field>
          <Field id="cred-meta-act" label="Meta ad_account_id">
            <Input
              id="cred-meta-act"
              dir="ltr"
              value={s2.metaAdAccountId}
              onChange={(e) => setCred('meta', { metaAdAccountId: e.target.value })}
              placeholder={ph('800776975668')}
            />
          </Field>
        </PlatformCredBlock>
      )}

      {/* Google — if checked */}
      {s1.hasGoogle && (
        <PlatformCredBlock
          title="Google"
          verifyState={verify.google}
          verifying={verifying.google}
          onVerify={() => runVerify('google')}
          highlight={focusPlatform === 'google'}
        >
          <Field id="cred-google-cid" label="Google customer_id">
            <Input
              id="cred-google-cid"
              dir="ltr"
              value={s2.googleCustomerId}
              onChange={(e) => setCred('google', { googleCustomerId: e.target.value })}
              placeholder={ph('4014537400')}
            />
          </Field>
          <Field
            id="cred-google-refresh"
            label="Google refresh_token"
            hint="dev/client = גלובלי משותף"
          >
            <Input
              id="cred-google-refresh"
              dir="ltr"
              type="password"
              value={s2.googleRefreshToken}
              onChange={(e) => setCred('google', { googleRefreshToken: e.target.value })}
              placeholder={ph('paste')}
            />
          </Field>
        </PlatformCredBlock>
      )}

      {/* Save-anyway override — bypasses ONLY the local client gate. The server
          ALWAYS re-verifies on create and writes nothing if the creds fail, so
          this can't force-save bad credentials. The copy says exactly that. */}
      <label className="mb-1 flex items-center gap-2 text-xs text-ink-secondary">
        <Checkbox
          checked={saveAnyway}
          onCheckedChange={setSaveAnyway}
        />
        שמור בכל זאת (דילוג על הבדיקה המקומית — השרת עדיין יאמת את הפרטים)
      </label>
      <Text as="p" tone="muted" className="mb-3 text-2xs">
        השרת תמיד מאמת את הפרטים לפני השמירה — חיבור שגוי לא יישמר גם אם תדלג על הבדיקה המקומית.
      </Text>

      {submitError && (
        <Text as="p" tone="default" role="alert" className="mb-3 text-sm text-status-redFg">
          {submitError}
        </Text>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canCreate}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'שמור שינויים' : 'צור חנות'}
        </Button>
        <Button type="button" variant="secondary" onClick={onBack} disabled={submitting}>
          → חזרה
        </Button>
      </div>
    </form>
  );
}

function PlatformCredBlock({
  title,
  verifyState,
  verifying,
  onVerify,
  highlight = false,
  children,
}: {
  title: string;
  verifyState: VerifyState;
  verifying: boolean;
  onVerify: () => void;
  /** D3 — when the credential matrix focuses this platform, ring it + scroll to it. */
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // jsdom does not implement scrollIntoView — guard so component tests pass.
    if (highlight && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlight]);
  return (
    <Card
      ref={ref}
      variant="flat"
      className={
        'mb-4 rounded-lg border bg-glass-2 p-3 ' +
        (highlight ? 'border-accent ring-2 ring-accent' : 'border-glass-edge')
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Heading level="panel" as="h3">
          {title}
        </Heading>
        <Button type="button" size="sm" variant="secondary" onClick={onVerify} disabled={verifying}>
          {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          בדוק
        </Button>
      </div>
      {children}
      {verifyState && (
        <div
          className={
            'mt-1 flex items-center gap-1.5 text-xs font-medium ' +
            (verifyState.ok ? 'text-status-greenFg' : 'text-status-redFg')
          }
          // A failed probe is assertive so AT announces it promptly; a success
          // stays polite (role="status").
          role={verifyState.ok ? 'status' : 'alert'}
        >
          {verifyState.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {verifyState.message || (verifyState.ok ? 'תקין' : 'נכשל')}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — snippet + operator checklist (post-create success screen).
// ---------------------------------------------------------------------------
function Step3({ created, onDone }: { created: CreatedStore; onDone: () => void }) {
  const snippet = generateStoreSnippet({
    storeId: created.storeId,
    cartPublicToken: created.cartPublicToken,
    allowedOrigins: [],
    isHeadless: created.isHeadless,
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-status-greenFg">
        <Check className="h-5 w-5" />
        <Heading level="panel" as="h3" className="text-status-greenFg">
          החנות נוצרה ב-DB
        </Heading>
      </div>
      <Text as="p" tone="muted" className="mb-4 text-xs">
        הטוקנים אומתו ונשמרו מוצפנים — בלי deploy. נשאר רק מה שב-Shopify (ידני):
      </Text>

      {created.secretsMasked && Object.keys(created.secretsMasked).length > 0 && (
        <div className="mb-4">
          <Heading level="label" as="h4" className="mb-1">
            סודות שנשמרו (מוסווים)
          </Heading>
          <ul className="text-xs text-ink-secondary" dir="ltr">
            {Object.entries(created.secretsMasked).map(([k, v]) => (
              <li key={k} className="font-mono">
                {k} = {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CodeBlock label={`Snippet להטמעה (${snippet.kind})`} code={snippet.primary} />
      {snippet.secondary && (
        <CodeBlock
          label={
            snippet.kind === 'headless'
              ? 'Edge function'
              : 'Theme snippet — _ft_* cart attributes (הדבק ב-theme.liquid)'
          }
          code={snippet.secondary}
        />
      )}
      {snippet.note && (
        <Text as="p" tone="muted" className="mb-4 text-xs">
          {snippet.note}
        </Text>
      )}

      <Heading level="label" as="h4" className="mb-1 mt-2">
        צ&apos;קליסט (Shopify — ידני, אין deploy)
      </Heading>
      <ul className="mb-4 list-inside list-disc text-xs text-ink-secondary marker:text-ink-muted">
        <li>צור Shopify custom app</li>
        <li>
          הענק scopes: <span dir="ltr">read_orders, read_products, read_customers</span>
        </li>
        <li>
          רשום webhook הזמנות/החזרים → <span dir="ltr">/api/webhooks/shopify</span>. הדבק כאן
          את ה-signing secret ש-Shopify הציג כשרשמת את ה-webhook (לא ה-Client Secret).
        </li>
        {created.isHeadless ? (
          <li>עדכן את ה-env של ה-edge-fn (ROAS_STORE_TOKEN) לפי ה-snippet</li>
        ) : (
          <>
            <li>הדבק את ה-Custom Pixel (primary) ב-Shopify → Settings → Customer events</li>
            <li>
              הדבק את ה-Theme snippet (secondary) ב-theme.liquid — כותב _ft_* cart attributes
              כך שההזמנות נושאות את מזהי הקמפיין/מודעה
            </li>
          </>
        )}
        <li>מיפוי TikTok נעשה ידנית מאוחר יותר ב-drawer של הקמפיין (חשבון משותף)</li>
      </ul>

      <Button type="button" onClick={onDone}>
        סיום
      </Button>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (jsdom / permissions) — silently no-op; the
      // operator can still select the code manually.
    }
  }
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Heading level="label" as="h4">
          {label}
        </Heading>
        <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label="העתק">
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'הועתק' : 'העתק'}
        </Button>
      </div>
      <pre
        dir="ltr"
        className="max-h-64 overflow-auto rounded-lg border border-glass-edge bg-glass-1 p-3 text-2xs leading-relaxed text-ink"
      >
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
