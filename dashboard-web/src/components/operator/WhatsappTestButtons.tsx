'use client';

// dashboard-web/src/components/operator/WhatsappTestButtons.tsx
//
// Phase 05.7.4 — operator "Send WhatsApp now" 3-button row.
//
// One button per trigger variant: noon (today snapshot), evening (today
// snapshot), eod (yesterday full-day). Lets the operator verify
// Vercel env vars + Meta token + template approval before relying on
// the scheduled crons (12:00 / 18:00 / 00:10 IL).
//
// Each click POSTs to /api/operator/notifications/send, which calls the SAME
// runWhatsappSlot(trigger) send helper that the scheduled Vercel-Cron digests
// (/api/cron/whatsapp) use — so behaviour-parity with the crons is guaranteed.
//
// Wave 5 Task 5.12 (P0-17) — double-confirm guard. Sending a WhatsApp
// dispatches a real message to +972524809540 (and the secondary number
// in notification_config). To prevent a one-click misfire on the Danger
// tab, the first click *arms* the button (3 s glow). A second click
// within the arm window actually sends. If the operator walks away or
// changes tabs, the arm state expires silently — no message is sent.
//
// Network-layer gate is /api/operator/* middleware (OPERATOR_SECRET).

import { useEffect, useState } from 'react';
import { Send, Loader2, AlertTriangle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';

type Trigger = 'noon' | 'evening' | 'eod';

const TRIGGER_LABELS: Record<Trigger, string> = {
  noon: 'שלח כמו 12:00 (היום עד כה)',
  evening: 'שלח כמו 18:00 (היום עד כה)',
  eod: 'שלח כמו 00:10 (סיכום של אתמול)',
};

const ARM_WINDOW_MS = 3000;

export function WhatsappTestButtons() {
  const [pendingKey, setPendingKey] = useState<Trigger | null>(null);
  const [armedKey, setArmedKey] = useState<Trigger | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-disarm after ARM_WINDOW_MS so a stale armed button can't be
  // triggered later by an accidental click. Resets on every re-arm.
  useEffect(() => {
    if (!armedKey) return;
    const id = window.setTimeout(() => setArmedKey(null), ARM_WINDOW_MS);
    return () => window.clearTimeout(id);
  }, [armedKey]);

  const send = async (trigger: Trigger) => {
    setPendingKey(trigger);
    setArmedKey(null);
    setMessage(null);
    setError(null);
    try {
      const res = await operatorFetch('/api/operator/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger }),
      });
      if (res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        `${TRIGGER_LABELS[trigger]} — ההודעה נשלחה. הודעת WhatsApp אמורה להגיע תוך 3-5 שניות לשני המספרים. אם לא הגיעה: בדוק /operator > פעילות (סטטוס אירועים).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingKey(null);
    }
  };

  const handleClick = (trigger: Trigger) => {
    if (pendingKey !== null) return;
    if (armedKey === trigger) {
      // Confirmed — fire.
      void send(trigger);
    } else {
      // Arm (or re-arm a different button).
      setArmedKey(trigger);
      setMessage(null);
      setError(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TRIGGER_LABELS) as Trigger[]).map((trigger) => {
          const isArmed = armedKey === trigger;
          const isPending = pendingKey === trigger;
          return (
            <Button
              key={trigger}
              type="button"
              variant={isArmed ? 'warning' : 'success'}
              onClick={() => handleClick(trigger)}
              disabled={pendingKey !== null}
              aria-pressed={isArmed}
              data-armed={isArmed || undefined}
              className={
                isArmed
                  ? 'gap-1 text-sm px-3 py-2 h-auto ring-2 ring-status-warning ring-offset-2 ring-offset-canvas'
                  : 'gap-1 text-sm px-3 py-2 h-auto'
              }
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : isArmed ? (
                <AlertTriangle className="w-4 h-4" aria-hidden />
              ) : (
                <Send className="w-4 h-4" aria-hidden />
              )}
              {isArmed
                ? `לחץ שוב לאישור — ${TRIGGER_LABELS[trigger]}`
                : TRIGGER_LABELS[trigger]}
            </Button>
          );
        })}
      </div>

      {message && (
        <p className="text-status-greenFg text-sm" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-status-redFg text-sm" role="alert">
          שגיאה: {error}
        </p>
      )}

      <p className="text-ink-secondary text-xs">
        * הקרון האוטומטי שולח 3 הודעות ביום: 12:00 / 18:00 / 00:10
        (Asia/Jerusalem). הכפתורים כאן שולחים אירוע ידני באותה לוגיקה
        בדיוק — לבדיקות מהירות ולסניטי-צ&apos;ק לאחר שינויי קונפיג
        (template חדש, רוטציית טוקן, וכו&apos;). לחיצה ראשונה חוממת את
        הכפתור (3 שניות) — לחיצה שנייה בתוך החלון שולחת באמת. אם תעזוב
        את הטאב, הכפתור מתפרק שקט ולא נשלח דבר.
      </p>
    </div>
  );
}
