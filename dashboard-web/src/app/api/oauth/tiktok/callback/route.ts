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

  if (error) {
    return new NextResponse(
      `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>TikTok OAuth — שגיאה</title>
<body style="font-family: system-ui; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111">
<h1 style="color: #b91c1c">❌ TikTok דחה את ההרשאה</h1>
<p><b>error:</b> ${htmlEscape(error)}</p>
<p><b>description:</b> ${htmlEscape(errorDesc)}</p>
<p>חזור ל-<a href="https://business-api.tiktok.com/portal/apps">TikTok Developers</a>
ובדוק שה-App מאושר ושה-redirect URL תואם לזה שרשום בו.</p>
</body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  if (!authCode) {
    return new NextResponse(
      `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>TikTok OAuth — חסר auth_code</title>
<body style="font-family: system-ui; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111">
<h1>⚠️ לא התקבל auth_code</h1>
<p>הקריאה הזו אמורה להגיע מ-TikTok אחרי שאישרת את ה-App. אם הגעת ישירות —
תתחיל את הזרם מ-TikTok Developers Portal.</p>
</body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // Build the one-shot curl command for exchanging auth_code → access_token.
  // Operator runs this locally with their App ID + App Secret filled in.
  const curlCmd = `curl -X POST 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' \\
  -H 'Content-Type: application/json' \\
  -d '{"app_id":"<YOUR_APP_ID>","secret":"<YOUR_APP_SECRET>","auth_code":"${authCode}"}'`;

  const html = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>TikTok OAuth — auth_code התקבל</title>
<body style="font-family: system-ui; max-width: 820px; margin: 40px auto; padding: 0 16px; color: #111; line-height: 1.6">
<h1 style="color: #047857">✅ TikTok auth_code התקבל</h1>

<h2>שלב 1 — העתק את ה-auth_code</h2>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px; user-select: all; word-break: break-all">${htmlEscape(authCode)}</pre>
${state ? `<p><b>state:</b> <code>${htmlEscape(state)}</code> &nbsp; <span style="color:#6b7280">(וודא שזה התואם ל-CSRF nonce שיצרת בזרם)</span></p>` : ''}

<h2>שלב 2 — החלף auth_code ל-access_token (חד-פעמי, תוקף ה-auth_code: שעה)</h2>
<p>פתח טרמינל ב-Mac/Linux והדבק (אחרי שמילאת את <code>APP_ID</code> ו-<code>APP_SECRET</code> מ-TikTok Developers Portal):</p>
<pre style="background:#1f2937; color:#f9fafb; padding:12px; border-radius:8px; user-select: all; white-space: pre-wrap; word-break: break-all">${htmlEscape(curlCmd)}</pre>

<h2>שלב 3 — שמור את התגובה</h2>
<p>התגובה תיראה ככה (JSON):</p>
<pre style="background:#f3f4f6; padding:12px; border-radius:8px">{
  "code": 0,
  "message": "OK",
  "data": {
    "access_token": "<token ארוך וקבוע>",
    "scope": ["Ad Account Management","Reporting"],
    "advertiser_ids": ["<advertiser_id מספרי>"]
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
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
