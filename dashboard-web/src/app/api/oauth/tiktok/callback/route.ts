// dashboard-web/src/app/api/oauth/tiktok/callback/route.ts
//
// Phase 05.7.5-B (scaffold) — TikTok OAuth callback receiver.
//
// One-time flow:
//   1. Operator clicks the TikTok authorization URL (printed in dashboard
//      or pasted from User Manual) → TikTok login → consent screen.
//   2. TikTok redirects to this endpoint with ?auth_code=XXX&state=YYY.
//   3. We render a plain HTML page showing the auth_code + a ready-to-run
//      `curl` command that exchanges it for the long-lived access_token.
//   4. Operator runs the curl, gets back a JSON with `access_token` +
//      `advertiser_ids` array.
//   5. Operator pastes those values into Vercel env vars
//      (`UZOSHOP_TIKTOK_ACCESS_TOKEN`, `UZOSHOP_TIKTOK_ADVERTISER_ID`).
//
// Why manual exchange instead of automatic POST-from-this-endpoint:
//   - The auth_code is single-use + 1-hour expiry. If our endpoint
//     auto-exchanges and fails (network blip, App Secret mismatch), the
//     operator would have to redo the OAuth login. Showing the auth_code
//     gives the operator a stable artifact they can retry exchanging
//     manually.
//   - We're avoiding storing the App Secret in env vars permanently — it
//     only needs to exist for the one-time exchange. The operator pastes
//     it INTO the curl command from their local copy, runs it once, then
//     never persists it server-side.
//
// Security:
//   - The `state` param is reflected verbatim — caller should set it to a
//     CSRF nonce when constructing the auth URL and verify it matches in
//     the rendered output.
//   - No secrets in this file. The App Secret stays on the operator's
//     machine during exchange.
//
// === Bilingual page (Phase 05.7.5-B follow-up, 2026-05-22) ===
//
// The page renders BOTH English and Hebrew so it's legible to:
//   - TikTok App reviewers visiting the redirect URL during App approval
//     (they don't read Hebrew; the English block tells them what the
//     endpoint does and why it exists)
//   - AI tools (Claude / GPT / etc.) that crawl the page on behalf of
//     the operator to extract the auth_code or curl command — they parse
//     English instruction text more reliably than Hebrew
//   - The operator (Hebrew block has the same content in their preferred
//     language)

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const authCode = url.searchParams.get('auth_code') ?? url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error') ?? '';
  const errorDesc = url.searchParams.get('error_description') ?? '';

  // -------------------------------------------------------------------
  // ERROR path: TikTok rejected the authorization or sent us back with
  // an explicit error. Show both English + Hebrew explanations.
  // -------------------------------------------------------------------
  if (error) {
    return new NextResponse(
      `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TikTok OAuth — Authorization Error</title>
<meta name="description" content="TikTok OAuth callback endpoint for ROAS Tracker ads-reporting dashboard. Received an error from TikTok during authorization.">
</head>
<body style="font-family: system-ui; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111; line-height: 1.6">

<section>
<h1 style="color: #b91c1c">❌ TikTok rejected the authorization</h1>
<p><b>error:</b> ${htmlEscape(error)}</p>
<p><b>description:</b> ${htmlEscape(errorDesc)}</p>
<p>This endpoint is the OAuth callback for a TikTok Marketing API App named
<b>ROAS Tracker — uzoshop</b>. It serves a single advertiser (uzoshop) and
only requests <code>Ad Account Management</code> + <code>Reporting</code>
scopes to display daily ROAS metrics on an internal dashboard. No automated
ad creation, no audience export, no data sharing.</p>
<p>If you're a TikTok App reviewer reaching this URL: this is the
correct redirect target documented in the App registration. The endpoint
renders an HTML page after a successful authorization (no auto-exchange,
no token persistence server-side).</p>
<p>Action: return to
<a href="https://business-api.tiktok.com/portal/apps">TikTok Developers Portal</a>
to retry, or verify the redirect URL on the App matches this endpoint.</p>
</section>

<hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd">

<section dir="rtl" lang="he">
<h1 style="color: #b91c1c">❌ TikTok דחה את ההרשאה</h1>
<p><b>error:</b> ${htmlEscape(error)}</p>
<p><b>description:</b> ${htmlEscape(errorDesc)}</p>
<p>חזור ל-<a href="https://business-api.tiktok.com/portal/apps">TikTok Developers</a>
ובדוק שה-App מאושר ושה-redirect URL תואם לזה שרשום בו.</p>
</section>

</body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // -------------------------------------------------------------------
  // NO auth_code path: direct visit, or App reviewer probing the URL.
  // Explain what this endpoint is in English + Hebrew.
  // -------------------------------------------------------------------
  if (!authCode) {
    return new NextResponse(
      `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ROAS Tracker — TikTok OAuth Callback</title>
<meta name="description" content="TikTok OAuth callback endpoint for ROAS Tracker. Receives auth_code from TikTok after advertiser authorizes the App. No data is persisted server-side until the operator manually exchanges the code for an access_token.">
</head>
<body style="font-family: system-ui; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111; line-height: 1.6">

<section>
<h1>ROAS Tracker — TikTok OAuth Callback</h1>
<p><b>Endpoint purpose</b>: receives <code>?auth_code=...&amp;state=...</code>
from TikTok after a successful advertiser authorization, and renders an
HTML page with the auth_code + a ready-to-paste curl command. The operator
runs the curl locally (App Secret stays on their machine), receives an
<code>access_token</code> + <code>advertiser_ids</code> JSON, and pastes
those values into Vercel environment variables.</p>

<p><b>What this endpoint does NOT do</b>:</p>
<ul>
<li>Does NOT auto-exchange the auth_code for an access_token (manual exchange
intentionally chosen because the auth_code is single-use + 1-hour-expiry —
auto-exchange failure on a network blip would force the operator to redo
the entire OAuth login)</li>
<li>Does NOT persist any credentials server-side</li>
<li>Does NOT call any TikTok API itself — only renders an instruction page</li>
</ul>

<p><b>If you are a TikTok App reviewer</b>: this URL is the
<code>Advertiser redirect URL</code> registered for the App
<code>ROAS Tracker — uzoshop</code>. The App requests two scopes
(<code>Ad Account Management</code> + <code>Reporting</code>) for a single
advertiser (uzoshop). Used for read-only daily reporting to display
ROAS metrics on an internal dashboard. No production traffic flows
through this endpoint; only one-time OAuth handshakes.</p>

<p><b>If you are an AI tool</b> (Claude, GPT, etc.) reaching this page
on behalf of the operator: the page below this paragraph (after a real
authorization) contains the auth_code and a ready-to-execute curl command.
The auth_code is the URL query parameter <code>auth_code</code> on the
redirect from <code>business-api.tiktok.com</code>.</p>

<p><b>To start authorization</b>: visit
<a href="https://business-api.tiktok.com/portal/apps">TikTok Developers Portal</a>
and click "Authorize" on the App. This URL is a redirect TARGET — not
a starting point.</p>
</section>

<hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd">

<section dir="rtl" lang="he">
<h1>ROAS Tracker — TikTok OAuth Callback (עברית)</h1>
<p><b>מה ה-endpoint הזה עושה</b>: קולט <code>?auth_code=...&amp;state=...</code>
מ-TikTok אחרי שאישרת את ה-App לחשבון המפרסם. מציג דף HTML עם ה-auth_code
ופקודת curl מוכנה. אתה מריץ את ה-curl במקומית (ה-App Secret נשאר על המחשב
שלך), מקבל בחזרה JSON עם <code>access_token</code> +
<code>advertiser_ids</code>, ומדביק את הערכים ל-Vercel env vars.</p>

<p><b>מה ה-endpoint לא עושה</b>: לא מבצע exchange אוטומטי; לא שומר
credentials בשרת; לא קורא ל-TikTok API בכלל. רק מציג הוראות.</p>

<p><b>כדי להתחיל</b>: לך ל-
<a href="https://business-api.tiktok.com/portal/apps">TikTok Developers</a>
ולחץ על "Authorize" ב-App. ה-URL הזה הוא יעד redirect — לא נקודת התחלה.</p>
</section>

</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // -------------------------------------------------------------------
  // SUCCESS path: TikTok sent us a valid auth_code. Render the
  // instruction page with both English + Hebrew sections.
  // -------------------------------------------------------------------
  const curlCmd = `curl -X POST 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' \\
  -H 'Content-Type: application/json' \\
  -d '{"app_id":"<YOUR_APP_ID>","secret":"<YOUR_APP_SECRET>","auth_code":"${authCode}"}'`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ROAS Tracker — TikTok OAuth auth_code Received</title>
<meta name="description" content="TikTok OAuth callback for ROAS Tracker. The auth_code below was received after the operator authorized the App. Run the curl command locally with App ID + App Secret to exchange it for an access_token. The auth_code expires in 1 hour and is single-use.">
</head>
<body style="font-family: system-ui; max-width: 820px; margin: 40px auto; padding: 0 16px; color: #111; line-height: 1.6">

<!-- ============================================================ -->
<!-- ENGLISH SECTION (for TikTok App reviewers + AI tools)        -->
<!-- ============================================================ -->
<section>
<h1 style="color: #047857">✅ TikTok auth_code received</h1>

<p><b>Context</b>: This endpoint is the OAuth callback for a TikTok Marketing
API App named <code>ROAS Tracker — uzoshop</code> with scopes
<code>Ad Account Management</code> + <code>Reporting</code>, serving a
single advertiser. The auth_code below was just received from TikTok after
a successful authorization. It expires in 1 hour and is single-use.</p>

<h2>Step 1 — Copy the auth_code</h2>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px; user-select: all; word-break: break-all">${htmlEscape(authCode)}</pre>
${state ? `<p><b>state:</b> <code>${htmlEscape(state)}</code> &nbsp; <span style="color:#6b7280">(verify this matches the CSRF nonce you set when constructing the auth URL)</span></p>` : ''}

<h2>Step 2 — Exchange auth_code for access_token (one-time, ~10 sec)</h2>
<p>Open a terminal (Mac/Linux) and run the command below, replacing
<code>&lt;YOUR_APP_ID&gt;</code> and <code>&lt;YOUR_APP_SECRET&gt;</code> with
the values from TikTok Developers Portal → Apps → ROAS Tracker → uzoshop:</p>
<pre style="background:#1f2937; color:#f9fafb; padding:12px; border-radius:8px; user-select: all; white-space: pre-wrap; word-break: break-all">${htmlEscape(curlCmd)}</pre>

<h2>Step 3 — Save the response JSON</h2>
<p>The response shape:</p>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px">{
  "code": 0,
  "message": "OK",
  "data": {
    "access_token": "&lt;long permanent token&gt;",
    "scope": ["Ad Account Management","Reporting"],
    "advertiser_ids": ["&lt;numeric advertiser id&gt;"]
  }
}</pre>

<h2>Step 4 — Paste into Vercel environment variables</h2>
<table style="border-collapse: collapse; width: 100%">
<tr><th style="border:1px solid #ccc; padding:6px; text-align:start">Name</th><th style="border:1px solid #ccc; padding:6px; text-align:start">Value</th></tr>
<tr><td style="border:1px solid #ccc; padding:6px"><code>UZOSHOP_TIKTOK_ADVERTISER_ID</code></td><td style="border:1px solid #ccc; padding:6px">advertiser_ids[0] from the JSON</td></tr>
<tr><td style="border:1px solid #ccc; padding:6px"><code>UZOSHOP_TIKTOK_ACCESS_TOKEN</code></td><td style="border:1px solid #ccc; padding:6px">access_token from the JSON</td></tr>
</table>
<p style="color:#6b7280">After pasting in Vercel → Settings → Environment
Variables → Redeploy → Phase B execution (wiring the fetcher into the
cron-daily handler) can begin.</p>

<h2>Notes for TikTok reviewers</h2>
<p>This endpoint never persists credentials server-side. The App Secret
stays on the operator's local machine (pasted into the curl command,
never sent here). The auth_code visible in the URL is single-use and
expires in 1 hour — by the time you read this in a review, the code
above is already invalid for any subsequent exchange. The endpoint is
read-only HTML rendering.</p>
</section>

<hr style="margin: 32px 0; border: none; border-top: 2px solid #ddd">

<!-- ============================================================ -->
<!-- HEBREW SECTION (for the operator)                            -->
<!-- ============================================================ -->
<section dir="rtl" lang="he">
<h1 style="color: #047857">✅ TikTok auth_code התקבל</h1>

<h2>שלב 1 — העתק את ה-auth_code</h2>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px; user-select: all; word-break: break-all">${htmlEscape(authCode)}</pre>
${state ? `<p><b>state:</b> <code>${htmlEscape(state)}</code> &nbsp; <span style="color:#6b7280">(וודא שזה תואם ל-CSRF nonce שיצרת בזרם)</span></p>` : ''}

<h2>שלב 2 — החלף auth_code ל-access_token (חד-פעמי, תוקף ה-auth_code: שעה)</h2>
<p>פתח טרמינל ב-Mac/Linux והדבק (אחרי שמילאת את <code>APP_ID</code> ו-<code>APP_SECRET</code> מ-TikTok Developers Portal):</p>
<pre style="background:#1f2937; color:#f9fafb; padding:12px; border-radius:8px; user-select: all; white-space: pre-wrap; word-break: break-all">${htmlEscape(curlCmd)}</pre>

<h2>שלב 3 — שמור את התגובה</h2>
<p>התגובה תיראה ככה (JSON):</p>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px">{
  "code": 0,
  "message": "OK",
  "data": {
    "access_token": "&lt;token ארוך וקבוע&gt;",
    "scope": ["Ad Account Management","Reporting"],
    "advertiser_ids": ["&lt;advertiser_id מספרי&gt;"]
  }
}</pre>

<h2>שלב 4 — הדבק ל-Vercel Env Vars</h2>
<table style="border-collapse: collapse; width: 100%">
<tr><th style="border:1px solid #ccc; padding:6px; text-align:start">Name</th><th style="border:1px solid #ccc; padding:6px; text-align:start">Value</th></tr>
<tr><td style="border:1px solid #ccc; padding:6px"><code>UZOSHOP_TIKTOK_ADVERTISER_ID</code></td><td style="border:1px solid #ccc; padding:6px">advertiser_ids[0] מ-JSON</td></tr>
<tr><td style="border:1px solid #ccc; padding:6px"><code>UZOSHOP_TIKTOK_ACCESS_TOKEN</code></td><td style="border:1px solid #ccc; padding:6px">access_token מ-JSON</td></tr>
</table>
<p style="color:#6b7280">אחרי הדבקה ב-Vercel → Settings → Environment Variables → Redeploy → תוכל לעבור ל-Phase B (wire-up).</p>

<h2>שלב 5 — תיידע אותי</h2>
<p>פשוט תכתוב לי "סיימתי OAuth" ב-Claude, ונעשה את Phase B (התקנה של ה-fetcher ב-cronDaily, ~6 שעות עבודה).</p>
</section>

</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
