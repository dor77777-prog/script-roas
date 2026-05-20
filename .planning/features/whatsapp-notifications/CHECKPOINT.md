---
feature: whatsapp-notifications
status: awaiting-meta-template-approval
last_updated: 2026-05-20
owner: dor77777-prog
---

# WhatsApp Notifications — Feature Checkpoint

> **Quick read**: WhatsApp summaries scheduled 3× daily (12:00 / 18:00 / 00:05 IDT) to 2 phones. All code shipped + properties set + recipients verified. Only thing blocking: Meta needs to approve the `roas_daily_summary` template. Once approved, follow the 4 steps in [§ After approval](#after-approval) and the feature goes live forever.

## TL;DR — pick up from here in 3 sentences

1. Code is on `main`, deployed to Apps Script via clasp (latest relevant commit: `0764bee`).
2. Meta `roas_daily_summary` Utility template is `IN REVIEW` (or APPROVED — check WhatsApp Manager).
3. When template moves to APPROVED: set `metacloud.templateName=roas_daily_summary` in Script Properties, run `testNoonNotification`, then run `setupNotificationTriggers` once.

---

## Goal

Send a Hebrew WhatsApp summary at three daily times to two phone numbers:

| Time (IDT) | What | Source date |
|---|---|---|
| 12:00 | "Today so far" snapshot | today |
| 18:00 | "Today so far" snapshot (refreshed) | today |
| 00:00–01:00* | Full-day summary | yesterday |

*Apps Script time-based triggers fire within a 1-hour window. `atHour(0)` = sometime in [00:00, 01:00) IDT.

Each message contains, per store:
- Spend (CAD)
- Revenue (CAD)
- ROAS
- Order count + breakdown by source (Facebook / Google / Other)

Plus a grand total across all stores + dashboard link.

---

## Architecture

```
Apps Script time-based trigger (3×/day)
   │
   ▼
sendNoonNotification / sendEveningNotification / sendEodNotification
   │
   ▼
sendNotificationForDate_(dateStr, title)        ← Notifications.gs
   │
   ├─ refreshAllStoresNow() (if dateStr == today)
   ├─ buildStoreSummary_(dateStr)
   │     │
   │     ├─ Reads data-daily tab (spend/revenue per store, CAD)
   │     └─ Reads {storeId}-orders-attribution (order counts by source)
   │
   ├─ buildMessageBody_(summary)         ← freeform fallback
   ├─ buildTemplateParameters_(summary)  ← 5-param array for template
   │
   └─ sendWhatsAppViaMetaCloud_(cfg, to, body, params)
        │
        ▼
        POST https://graph.facebook.com/v18.0/{phoneNumberId}/messages
           ├─ Authorization: Bearer {accessToken}
           ├─ to: recipient
           ├─ type: 'template' (production) or 'text' (24h freeform window)
           └─ template.components[0].parameters: [...5 items...]
```

Provider switchable via `notify.provider` Script Property:
- `metacloud` (default) — Meta Cloud API direct
- `twilio` — Twilio fallback if/when account is reinstated

---

## Status snapshot (2026-05-20)

### ✅ Done

- [x] `Notifications.gs` shipped on main (1×main file, ~300+ lines)
- [x] Provider switch implemented (`notify.provider`: `metacloud` | `twilio`)
- [x] 5-parameter template support in `sendWhatsAppViaMetaCloud_`
- [x] `buildTemplateParameters_` builds parameter array in correct order
- [x] `buildStoreSummary_` reads data-daily + orders-attribution
- [x] Order count breakdown (Facebook / Google / Other) wired
- [x] CAD formatting
- [x] Setup helpers: `setupNotificationTriggers`, `listNotificationTriggers`, `removeAllNotificationTriggers`
- [x] Test helpers: `testNoonNotification`, `testEveningNotification`, `testEodNotification`
- [x] Error reporting via `notifyError_` (existing email pipeline)
- [x] Meta Developer App created (ID 1485720843097459)
- [x] WhatsApp product added to app
- [x] Test phone number assigned by Meta (+1 555 652 6181)
- [x] Both recipient phones verified in Meta API Setup
- [x] Apps Script Properties configured (see [§ Configuration](#configuration))
- [x] End-to-end smoke test executed — Meta API returned 200, webhook diagnosed delivery failure as error 131047 (24h conversation window)
- [x] Template designed with 5 placeholders + samples + body wording

### ⏳ Blocking — waiting on external party

- [ ] Meta approves the `roas_daily_summary` Utility template
  - Submitted by user in WhatsApp Manager
  - Status: IN REVIEW (check `business.facebook.com/wa/manage/message-templates`)
  - Typical SLA: 1-12 hours for Utility category

### 📝 After Meta approval — 4 steps

See [§ After approval](#after-approval) below.

### 🔐 Long-term TODO (not blocking)

- [ ] Generate permanent System User access token (current token expires every 24h)
- [ ] Optional: upgrade from Meta test phone number to dedicated production number (still free up to 1000 conversations/month)

---

## Configuration

### Meta Cloud API assets (all stored at Meta's side)

| Asset | Value | Where |
|---|---|---|
| App ID | `1485720843097459` | Meta Developer Dashboard |
| App Name | `ROAS Tracker Notifications` | Meta Developer Dashboard |
| Business Portfolio | `IDF_SINGLE` | Meta Business Manager |
| WABA ID (WhatsApp Business Account) | `1479123570363252` | Meta API Setup |
| Phone Number ID | `1091010644104167` | Meta API Setup |
| Test phone (from) | `+1 555 652 6181` | Meta API Setup (read-only) |
| Verified test recipient #1 | `+972524809540` | Meta API Setup |
| Verified test recipient #2 | `+972546100067` | Meta API Setup |

### Apps Script Properties (Project Settings → Script Properties)

| Key | Value | Notes |
|---|---|---|
| `notify.provider` | `metacloud` | switch to `twilio` if Twilio reinstated |
| `notify.dashboardUrl` | `https://roas-dashboard-smoky.vercel.app` | optional; default same |
| `notify.phone1` | `+972524809540` | E.164 with `+` prefix, no `whatsapp:` prefix |
| `notify.phone2` | `+972546100067` | same format; optional |
| `metacloud.phoneNumberId` | `1091010644104167` | from Meta API Setup |
| `metacloud.accessToken` | `EAA...` | **temporary 24h token; regenerate or upgrade to permanent** |
| `metacloud.templateName` | (blank or `-`) | **change to `roas_daily_summary` after approval** |
| `metacloud.templateLang` | `he` | Hebrew |

Legacy Twilio-mode properties (still in storage; ignored when `notify.provider=metacloud`):
- `twilio.accountSid`, `twilio.authToken`, `twilio.whatsappFrom` — Twilio compliance suspended the account; keeping properties for easy switch back if reinstated.

---

## Template — `roas_daily_summary`

### Meta WhatsApp template configuration

- **Name**: `roas_daily_summary`
- **Category**: `Utility`
- **Language**: `Hebrew (he)`
- **Header**: (none or simple text)
- **Footer**: (optional) `ROAS Tracker`
- **Buttons**: (optional) URL button → label `פתח דשבורד` → URL `https://roas-dashboard-smoky.vercel.app`

### Body text

```
📊 דוח ROAS יומי

תאריך ושעה: {{1}}

{{2}}

{{3}}

{{4}}

{{5}}

לפרטים מלאים — פתח את הדשבורד.
```

### Placeholder samples (required by Meta for approval)

| # | Sample value | Built by code from |
|---|---|---|
| {{1}} | `12:00, 20/05/2026` | trigger title |
| {{2}} | `🏪 uzoshop:` + 4-line block | `buildTemplateParameters_` (store #1) |
| {{3}} | `🏪 zolplus:` + 4-line block | `buildTemplateParameters_` (store #2) |
| {{4}} | `🏪 usmile360:` + 4-line block | `buildTemplateParameters_` (store #3) |
| {{5}} | `🎯 סה"כ:` + 4-line block | `buildTemplateParameters_` (totals) |

### Full sample (what Meta sees on review)

```
📊 דוח ROAS יומי

תאריך ושעה: 12:00, 20/05/2026

🏪 uzoshop:
• הוצאה: C$450
• הכנסות: C$1,890
• ROAS: 4.20
• הזמנות: 28  (פייסבוק: 18, גוגל: 6, אחרים: 4)

🏪 zolplus:
• הוצאה: C$320
• הכנסות: C$1,150
• ROAS: 3.59
• הזמנות: 19  (פייסבוק: 10, גוגל: 5, אחרים: 4)

🏪 usmile360:
• הוצאה: C$180
• הכנסות: C$540
• ROAS: 3.00
• הזמנות: 9  (פייסבוק: 4, גוגל: 3, אחרים: 2)

🎯 סה"כ:
• הוצאה: C$950
• הכנסות: C$3,580
• ROAS: 3.77
• הזמנות: 56  (פייסבוק: 32, גוגל: 14, אחרים: 10)

לפרטים מלאים — פתח את הדשבורד.
```

---

## After approval

When Meta approves the template (you'll get an email from Meta and `Status: APPROVED` in WhatsApp Manager), execute these 4 steps:

### Step 1 — Update `metacloud.templateName`

1. `script.google.com` → ROAS project → ⚙️ Project Settings → Script Properties.
2. Find `metacloud.templateName`.
3. Set value to: `roas_daily_summary`
4. Save.

### Step 2 — Verify token is still valid (or regenerate)

The temporary access token expires 24 hours after creation. If it's been more than ~22 hours since you last generated:
- Go to Meta App Dashboard → WhatsApp → API Setup → click `Regenerate token`.
- Copy the new token.
- Update `metacloud.accessToken` in Apps Script Properties.

For a permanent token (recommended): see [§ Permanent token](#permanent-token-recommended) below.

### Step 3 — Test end-to-end

In Apps Script editor:
1. Open `Notifications.gs`.
2. Select function `testNoonNotification` from the function dropdown.
3. Click `Run`.

Expected logs:
```
Sent WhatsApp summary for 2026-05-XX to +972524809540 via metacloud
Sent WhatsApp summary for 2026-05-XX to +972546100067 via metacloud
```

Both phones should receive the formatted WhatsApp within 2-3 seconds.

If anything fails — see [§ Troubleshooting](#troubleshooting).

### Step 4 — Activate the 3 daily triggers

In Apps Script editor:
1. Select function `setupNotificationTriggers`.
2. Click `Run`.
3. Accept any permission prompts (ScriptApp.newTrigger needs them).

Expected log:
```
Created 3 notification triggers: 12:00, 18:00, ~00:00-01:00 daily (script TZ).
```

✓ **Feature is now live.** Apps Script will fire the triggers automatically every day with no further intervention.

---

## Permanent token (recommended)

The temporary access token only lasts 24 hours. For 24/7 production reliability, create a System User token.

1. `business.facebook.com/settings/system-users`
2. Select Business Portfolio `IDF_SINGLE`.
3. **Users → System Users → Add** → Name: `RoasTrackerSystem` → Role: `Admin` → Create.
4. Select the new System User → **Add Assets** → **Apps** → select `ROAS Tracker Notifications` → Full control → Save.
5. Click **Generate New Token**:
   - App: ROAS Tracker Notifications
   - Expiration: `Never` (if available)
   - Permissions:
     - ✅ `whatsapp_business_messaging`
     - ✅ `whatsapp_business_management`
6. Copy the generated token.
7. Apps Script → Script Properties → update `metacloud.accessToken` with the new token → Save.

Result: the token won't expire; triggers will keep working indefinitely.

---

## Troubleshooting

### `Sent WhatsApp summary ...` in logs but no message arrives

The Meta API returned 2xx (accepted to queue) but delivery failed downstream. Check the webhook payload in Meta API Setup → "Check test webhooks". Common error codes:

| Code | Title | Cause | Fix |
|---|---|---|---|
| 131047 | Re-engagement message | Sending freeform outside 24h conversation window | Use approved template (set `metacloud.templateName`) — this is what we're solving |
| 131026 | Message undeliverable | Recipient doesn't have WhatsApp or blocked test number | Verify the number has WhatsApp; check WhatsApp settings |
| 132001 | Template name does not exist | Template name typo or wrong language | Verify exact template name in Meta and that `metacloud.templateLang` matches the language code |
| 132012 | Parameter count mismatch | Code sends N params, template expects M | Update `buildTemplateParameters_` to match template structure |
| 100 / 190 | OAuth error | Access token expired (24h) or invalid | Regenerate token in Meta API Setup OR set up permanent System User token |

### `Missing Script Properties: ...`

`getNotifyConfig_` throws when required keys are missing. Check the `notify.provider` value — if `metacloud`, required keys are: `metacloud.phoneNumberId`, `metacloud.accessToken`, `notify.phone1`. Add or fix the listed keys in Apps Script Properties.

### Triggers were set up but no messages firing at scheduled times

Check Apps Script → Triggers (clock icon) — confirm 3 entries for `sendNoonNotification`, `sendEveningNotification`, `sendEodNotification`. If missing, re-run `setupNotificationTriggers`. If present but not firing, check Apps Script → Executions for error history.

### Token expires every 24 hours (long-term issue)

Generate a permanent System User token. See [§ Permanent token](#permanent-token-recommended) above.

---

## Code references

### Main files

- [`Notifications.gs`](../../../Notifications.gs) — feature implementation (~300+ lines)
- [`DailyUpdate.gs`](../../../DailyUpdate.gs) — `refreshAllStoresNow()` is called before sending today's summary
- [`Config.gs`](../../../Config.gs) — `ordersAttributionTabName_()` resolves per-store tab name; `TZ` constant
- [`SheetBuilder.gs`](../../../SheetBuilder.gs) — `ensureSpreadsheet()`, `ORDERS_ATTRIBUTION_HEADERS`

### Key functions in `Notifications.gs`

| Function | Purpose |
|---|---|
| `sendNoonNotification` | Trigger for 12:00 — today snapshot |
| `sendEveningNotification` | Trigger for 18:00 — today snapshot |
| `sendEodNotification` | Trigger for 00:00–01:00 — yesterday summary |
| `setupNotificationTriggers` | One-time setup — creates the 3 daily Apps Script triggers |
| `listNotificationTriggers` | Diagnostic — list current triggers |
| `removeAllNotificationTriggers` | Cleanup — remove all 3 triggers |
| `testNoonNotification` / `testEveningNotification` / `testEodNotification` | Manual test runs |
| `getNotifyConfig_` | Reads Script Properties + validates per-provider required keys |
| `sendWhatsAppViaMetaCloud_` | Sends via Meta Cloud API (template or freeform mode) |
| `sendWhatsAppViaTwilio_` | Sends via Twilio (used when `notify.provider=twilio`) |
| `buildStoreSummary_` | Aggregates spend/revenue/order-counts per store + totals |
| `buildMessageBody_` | Renders single-string body (freeform / Twilio) |
| `buildTemplateParameters_` | Builds 5-param array matching `roas_daily_summary` placeholders |

### Recent commits

| Commit | Message |
|---|---|
| `0764bee` | feat(notifications): send 5 template parameters for roas_daily_summary |
| `a8c6bc0` | fix(notifications): treat placeholder template names (-, none, null) as freeform |
| `3d7779e` | feat(notifications): add Meta Cloud API provider, switchable via notify.provider |
| `0c6dd55` | fix(notifications): make notify.phone2 optional — single-recipient mode |
| `f8dd7c4` | feat(notifications): WhatsApp 3x-daily summary via Twilio |

---

## How to resume work from this checkpoint

Whoever picks this up (you in a future session, a partner, future-Claude):

1. Read this whole file.
2. Check Meta's WhatsApp Manager for template status: `business.facebook.com/wa/manage/message-templates`.
3. If `APPROVED` → execute [§ After approval](#after-approval) (4 steps, ~5 minutes).
4. If still `IN REVIEW` → wait or check again later.
5. If `REJECTED` → look at Meta's rejection reason. Common fixes:
   - Add explicit static text at start AND end of body (already done)
   - Adjust sample data to be more realistic / less promotional
   - Resubmit
6. Once notifications are running, set up permanent token (see [§ Permanent token](#permanent-token-recommended)) to avoid 24h expirations.

---

## Future enhancements (not blocking)

- [ ] Permanent System User access token (avoid 24h expiration churn)
- [ ] Production WhatsApp Business phone number (instead of Meta test number — gives branded "from" and higher limits)
- [ ] Webhook receiver for delivery confirmation (currently we don't know if message actually reached recipient)
- [ ] Make template parameters reflect ACTUAL store count instead of hardcoded 3 (currently fills "—" for missing slots; works for 3 stores)
- [ ] Optional second recipient list (e.g., per-store owners get only their store's summary)
- [ ] Different message formats per trigger (e.g., 00:05 = full report; 12:00 / 18:00 = brief snapshot)
- [ ] Localize the template content from Hebrew to user-selectable language
- [ ] Add a button on the dashboard to "Send me a summary now" that triggers `testNoonNotification` server-side
