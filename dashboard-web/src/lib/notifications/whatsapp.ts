// Phase 05.7.4 — Meta WhatsApp Cloud API direct sender (TS port of
// `Notifications.gs:sendWhatsAppViaMetaCloud_` at lines 154-215).
//
// Twilio is NOT supported in the TS port — `notification_config` row for
// twilio is `active=FALSE` and has been since Phase 05.5-01 seeded the
// table. If Twilio is ever reinstated, add a sibling sender; for now,
// metacloud is the single path.
//
// Why Meta Cloud direct (and not Twilio):
//   1. Free up to 1000 conversations/month vs Twilio's per-message pricing
//   2. No middleman (Twilio account compliance suspended ours mid-2025)
//   3. Templates are managed directly in Meta WhatsApp Manager — single
//      source of truth, no shadow copy in Twilio Console
//
// Token strategy:
//   - The Apps Script version used `metacloud.accessToken` (Script Property
//     — temp 24h token by default unless operator generated a System User).
//   - The TS version reads from `WHATSAPP_ACCESS_TOKEN` env var (Vercel),
//     with the expectation that this is a permanent System User token. See
//     `docs/ROAS-Dashboard-User-Manual.md` § WhatsApp setup for the 7-click
//     generation flow.

// Bumped 2026-05-22 from v23.0 → v25.0 ahead of the 2026-06-09 deprecation
// of every version <v24.0. WhatsApp Cloud API /messages payload shape unchanged
// across v23..v25 for template messages (text + components.body[].parameters).
const META_API_VERSION = 'v25.0';

export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLang: string;
};

/**
 * Reads the env-stored portion of the config (the secrets + the per-WABA
 * phone-number-id). The per-instance details (template name / language /
 * recipients) come from the `notification_config` Postgres row — see
 * `loadNotificationRow` below.
 */
export function getWhatsAppCredsFromEnv(): {
  phoneNumberId: string;
  accessToken: string;
} {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const missing: string[] = [];
  if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (missing.length) {
    throw new Error(
      'notifications/whatsapp: missing env vars ' + missing.join(', '),
    );
  }
  return { phoneNumberId: phoneNumberId!, accessToken: accessToken! };
}

/**
 * Send one WhatsApp template message via Meta Cloud API.
 *
 * `toNumber` is E.164 with the `+` prefix (e.g. `+972524809540`); Meta
 * accepts both forms but we strip the `+` to match their preferred shape.
 *
 * `templateParams` MUST have exactly the same count as the {{N}}
 * placeholders in the approved template — Meta rejects mismatches with
 * error 132012 ("Parameter count mismatch"). For `roas_daily_summary`
 * that's exactly 5 strings.
 *
 * Throws on non-2xx with the Meta error body trimmed to 800 chars.
 * Inngest's retry layer (4 retries, exponential backoff) handles
 * transient 5xx and rate-limit 429s.
 */
/**
 * Audit fix 2026-05-23 (HR-05 health-and-conclusions): recipient allowlist.
 *
 * Daily summary + (eventually) token-failure alerts both flow through
 * `sendWhatsAppTemplate`. The destinations come from `notification_config`
 * rows in Postgres — i.e., editable from the /operator UI. A typo in the
 * operator UI would have silently fanned out daily summaries to a
 * stranger's WhatsApp 3 times/day until someone noticed.
 *
 * Env-var allowlist (`NOTIFICATION_RECIPIENT_ALLOWLIST`):
 *   Comma-separated phone numbers (with or without leading `+`, with
 *   or without dashes). When set, sendWhatsAppTemplate REJECTS any
 *   destination not in the list — logged loudly so the operator notices.
 *   When NOT set, no allowlist enforcement (back-compat for instances
 *   that don't want it).
 *
 * Project-memory contract: operator's token-failure alerts go ONLY to
 * +972524809540. Operator should set NOTIFICATION_RECIPIENT_ALLOWLIST
 * to that value to enforce the contract across all WhatsApp sends.
 */
function recipientAllowed(toDigitsOnly: string): { allowed: boolean; reason?: string } {
  const raw = process.env.NOTIFICATION_RECIPIENT_ALLOWLIST;
  if (!raw || raw.trim() === '') {
    // No allowlist configured → permissive (backwards-compat).
    return { allowed: true };
  }
  const allowed = raw
    .split(',')
    .map(s => s.trim().replace(/^\+/, '').replace(/[^0-9]/g, ''))
    .filter(s => s.length > 0);
  if (allowed.includes(toDigitsOnly)) return { allowed: true };
  return {
    allowed: false,
    reason: `recipient ${toDigitsOnly} not in NOTIFICATION_RECIPIENT_ALLOWLIST (${allowed.length} numbers configured)`,
  };
}

export async function sendWhatsAppTemplate(args: {
  toNumber: string;
  templateName: string;
  templateLang: string;
  templateParams: string[];
}): Promise<{ messageId?: string }> {
  const { phoneNumberId, accessToken } = getWhatsAppCredsFromEnv();
  const { toNumber, templateName, templateLang, templateParams } = args;

  const to = String(toNumber).replace(/^\+/, '').replace(/[^0-9]/g, '');

  // Allowlist gate (HR-05). Throwing here means sendDailySummary's
  // per-recipient try/catch (T3.5) reports the rejection in
  // recipientsFailed and the operator sees it surfaced as a failed run.
  const check = recipientAllowed(to);
  if (!check.allowed) {
    throw new Error(
      `Refused to send WhatsApp template "${templateName}" — ${check.reason}. ` +
        `Add ${to} to NOTIFICATION_RECIPIENT_ALLOWLIST env var if intentional.`,
    );
  }
  const url = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: 'body',
          parameters: templateParams.map((p) => ({
            type: 'text',
            text: String(p ?? ''),
          })),
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Meta Cloud HTTP ${res.status} (template=${templateName} to=${to}): ${body.slice(
        0,
        800,
      )}`,
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
  };
  return { messageId: json?.messages?.[0]?.id };
}

// ────────────────────────────────────────────────────────────────────────
// notification_config helpers — reads the per-instance row from Postgres
// ────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type NotificationConfigRow = {
  provider: string;
  active: boolean;
  templateName: string;
  templateLang: string;
  dashboardUrl: string;
  phone1: string | null;
  phone2: string | null;
};

function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'notifications/whatsapp: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Load the single active metacloud notification_config row. Returns null
 * if no active row exists — caller should treat as "notifications
 * disabled" and skip the send.
 */
export async function loadActiveMetacloudConfig(): Promise<NotificationConfigRow | null> {
  const sb = admin();
  const { data, error } = await sb
    .from('notification_config')
    .select(
      'provider, active, template_name, template_lang, dashboard_url, phone1, phone2',
    )
    .eq('provider', 'metacloud')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`notifications/whatsapp config query: ${error.message}`);
  }
  if (!data) return null;
  return {
    provider: String(data.provider),
    active: data.active === true,
    templateName: String(data.template_name ?? ''),
    templateLang: String(data.template_lang ?? 'he'),
    dashboardUrl: String(data.dashboard_url ?? ''),
    phone1: data.phone1 ? String(data.phone1) : null,
    phone2: data.phone2 ? String(data.phone2) : null,
  };
}
