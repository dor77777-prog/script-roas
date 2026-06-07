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

import { useState } from 'react';
import { Check, X, Copy, Loader2 } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { generateStoreSnippet } from '@/lib/storeSnippets';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  { value: 'var(--band-blue)', label: 'כחול' },
  { value: 'var(--band-orange)', label: 'כתום' },
];

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
}

interface Step2State {
  shopifyClientId: string;
  shopifyClientSecret: string;
  metaToken: string;
  metaAdAccountId: string;
  googleCustomerId: string;
  googleRefreshToken: string;
}

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
};

const EMPTY_STEP2: Step2State = {
  shopifyClientId: '',
  shopifyClientSecret: '',
  metaToken: '',
  metaAdAccountId: '',
  googleCustomerId: '',
  googleRefreshToken: '',
};

export function AddStoreWizard({ onDone, editStoreId }: AddStoreWizardProps) {
  const isEdit = typeof editStoreId === 'string' && editStoreId.length > 0;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [s1, setS1] = useState<Step1State>(() =>
    isEdit ? { ...EMPTY_STEP1, storeId: editStoreId! } : EMPTY_STEP1,
  );
  const [s2, setS2] = useState<Step2State>(EMPTY_STEP2);

  const [slugError, setSlugError] = useState<string | null>(null);
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

    if (!s1.name.trim()) ok = false;
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

  // Required platforms = Shopify always + Meta-if-checked + Google-if-checked.
  const requiredPlatforms: Platform[] = ['shopify'];
  if (s1.hasMeta) requiredPlatforms.push('meta');
  if (s1.hasGoogle) requiredPlatforms.push('google');

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
      const payload: Record<string, unknown> = {
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
      if (s1.hasMeta) payload.meta = { token: s2.metaToken, adAccountId: s2.metaAdAccountId };
      if (s1.hasGoogle) {
        payload.google = { customerId: s2.googleCustomerId, refreshToken: s2.googleRefreshToken };
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

      {step === 1 && (
        <Step1
          s1={s1}
          setS1={setS1}
          slugError={slugError}
          domainError={domainError}
          isEdit={isEdit}
          onNext={goToStep2}
          onCancel={onDone}
        />
      )}

      {step === 2 && (
        <Step2
          s1={s1}
          s2={s2}
          setS2={setS2}
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
  slugError,
  domainError,
  isEdit,
  onNext,
  onCancel,
}: {
  s1: Step1State;
  setS1: React.Dispatch<React.SetStateAction<Step1State>>;
  slugError: string | null;
  domainError: string | null;
  isEdit: boolean;
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
        />
      </Field>

      <Field id="store-domain" label="דומיין Shopify">
        <Input
          id="store-domain"
          dir="ltr"
          value={s1.shopDomain}
          onChange={(e) => setS1((s) => ({ ...s, shopDomain: e.target.value }))}
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

      {/* Brand color */}
      <Field id="store-brand" label="צבע-מותג">
        <NativeSelect
          id="store-brand"
          value={s1.brandColor}
          onChange={(e) => setS1((s) => ({ ...s, brandColor: e.target.value }))}
        >
          {BRAND_COLORS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <div className="mt-2 flex items-center gap-2" aria-hidden="true">
          {BRAND_COLORS.map((c) => (
            <span
              key={c.value}
              className={
                'h-5 w-5 rounded-md border border-glass-edge ' +
                (c.value === s1.brandColor ? 'ring-2 ring-accent' : '')
              }
              style={{ background: c.value }}
            />
          ))}
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

      {/* Platform toggles */}
      <div className="mb-4">
        <span className="mb-2 block text-xs font-medium text-ink-secondary">פלטפורמות פעילות</span>
        <div className="flex flex-wrap gap-2">
          <PlatformToggle
            label="Meta"
            checked={s1.hasMeta}
            onChange={(v) => setS1((s) => ({ ...s, hasMeta: v }))}
          />
          <PlatformToggle
            label="Google"
            checked={s1.hasGoogle}
            onChange={(v) => setS1((s) => ({ ...s, hasGoogle: v }))}
          />
          <PlatformToggle
            label="TikTok"
            note="(חשבון משותף)"
            checked={s1.hasTiktok}
            onChange={(v) => setS1((s) => ({ ...s, hasTiktok: v }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onNext}>
          הבא →
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
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-glass-edge bg-glass-2 px-3 py-1.5 text-sm text-ink">
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
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
  setS2,
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
  setS2: React.Dispatch<React.SetStateAction<Step2State>>;
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onSubmit();
      }}
    >
      <Text as="p" tone="muted" className="mb-4 text-xs">
        הדבק את הטוקנים. ה-&quot;בדוק&quot; מאמת חי מול הספק לפני יצירת החנות.
        הטוקנים נשמרים מוצפנים — לעולם לא מוחזרים גלויים.
      </Text>

      {/* Shopify — always */}
      <PlatformCredBlock
        title="Shopify"
        verifyState={verify.shopify}
        verifying={verifying.shopify}
        onVerify={() => runVerify('shopify')}
      >
        <Field id="cred-shop-id" label="Shopify client_id">
          <Input
            id="cred-shop-id"
            dir="ltr"
            value={s2.shopifyClientId}
            onChange={(e) => setS2((s) => ({ ...s, shopifyClientId: e.target.value }))}
            placeholder="paste"
          />
        </Field>
        <Field id="cred-shop-secret" label="Shopify client_secret">
          <Input
            id="cred-shop-secret"
            dir="ltr"
            type="password"
            value={s2.shopifyClientSecret}
            onChange={(e) => setS2((s) => ({ ...s, shopifyClientSecret: e.target.value }))}
            placeholder="paste"
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
        >
          <Field id="cred-meta-token" label="Meta access_token">
            <Input
              id="cred-meta-token"
              dir="ltr"
              type="password"
              value={s2.metaToken}
              onChange={(e) => setS2((s) => ({ ...s, metaToken: e.target.value }))}
              placeholder="paste"
            />
          </Field>
          <Field id="cred-meta-act" label="Meta ad_account_id">
            <Input
              id="cred-meta-act"
              dir="ltr"
              value={s2.metaAdAccountId}
              onChange={(e) => setS2((s) => ({ ...s, metaAdAccountId: e.target.value }))}
              placeholder="800776975668"
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
        >
          <Field id="cred-google-cid" label="Google customer_id">
            <Input
              id="cred-google-cid"
              dir="ltr"
              value={s2.googleCustomerId}
              onChange={(e) => setS2((s) => ({ ...s, googleCustomerId: e.target.value }))}
              placeholder="4014537400"
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
              onChange={(e) => setS2((s) => ({ ...s, googleRefreshToken: e.target.value }))}
              placeholder="paste"
            />
          </Field>
        </PlatformCredBlock>
      )}

      {/* Save-anyway override */}
      <label className="mb-3 flex items-center gap-2 text-xs text-ink-secondary">
        <Input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={saveAnyway}
          onChange={(e) => setSaveAnyway(e.target.checked)}
        />
        שמור בכל זאת (דלג על אימות-חי — באחריותך)
      </label>

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
          ← חזרה
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
  children,
}: {
  title: string;
  verifyState: VerifyState;
  verifying: boolean;
  onVerify: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card variant="flat" className="mb-4 rounded-lg border border-glass-edge bg-glass-2 p-3">
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
          role="status"
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
      {snippet.secondary && <CodeBlock label="Edge function" code={snippet.secondary} />}
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
          רשום webhook הזמנות/החזרים → <span dir="ltr">/api/webhooks/shopify</span> (signing
          secret = ה-API secret key של האפליקציה שהזנת)
        </li>
        <li>
          {created.isHeadless
            ? 'עדכן את ה-env של ה-edge-fn (ROAS_STORE_TOKEN) לפי ה-snippet'
            : 'הדבק את ה-Custom Pixel ב-Shopify לפי ה-snippet'}
        </li>
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
