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
// Each click POSTs to /api/operator/notifications/send which fires an
// Inngest event. The cron's same `eventWhatsappSendNow` worker handles
// the event, so behaviour-parity with the scheduled crons is guaranteed.

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';

type Trigger = 'noon' | 'evening' | 'eod';

const TRIGGER_LABELS: Record<Trigger, string> = {
  noon: 'שלח כמו 12:00 (היום עד כה)',
  evening: 'שלח כמו 18:00 (היום עד כה)',
  eod: 'שלח כמו 00:10 (סיכום של אתמול)',
};

export function WhatsappTestButtons() {
  const [pendingKey, setPendingKey] = useState<Trigger | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (trigger: Trigger) => {
    setPendingKey(trigger);
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
        `${TRIGGER_LABELS[trigger]} — האירוע נשלח ל-Inngest. הודעת WhatsApp אמורה להגיע תוך 3-5 שניות לשני המספרים. אם לא הגיעה: בדוק /operator > ריצות אחרונות.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TRIGGER_LABELS) as Trigger[]).map((trigger) => (
          <Button
            key={trigger}
            type="button"
            variant="ghost"
            onClick={() => send(trigger)}
            disabled={pendingKey !== null}
            className="gap-1 bg-status-green hover:bg-status-green/90 disabled:bg-elevated2 disabled:text-ink-muted text-white text-sm px-3 py-2 h-auto"
          >
            {pendingKey === trigger ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {TRIGGER_LABELS[trigger]}
          </Button>
        ))}
      </div>

      {message && (
        <p className="text-status-green text-sm" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-status-red text-sm" role="alert">
          שגיאה: {error}
        </p>
      )}

      <p className="text-ink-secondary text-xs">
        * הקרון האוטומטי שולח 3 הודעות ביום: 12:00 / 18:00 / 00:10
        (Asia/Jerusalem). הכפתורים כאן שולחים אירוע ידני באותה לוגיקה
        בדיוק — לבדיקות מהירות ולסניטי-צ&apos;ק לאחר שינויי קונפיג
        (template חדש, רוטציית טוקן, וכו&apos;).
      </p>
    </div>
  );
}
