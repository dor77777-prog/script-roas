'use client';

/**
 * Drill-down of the unknown/direct order bucket (opened from the hero
 * CoverageChip). DESCRIPTIVE only — describes WHO these orders are (new vs
 * returning, basket size, payment method, store) but NEVER redistributes the
 * unknown share across channels (covered + unknown still = 100%; per-channel
 * ROAS is untouched). Token-driven, light+dark, RTL, WCAG-AA; CAD via <Money>,
 * raw counts via <bdi dir="ltr">, no native title (HelpTooltip-only chrome).
 * CAPI-safe: pure render of already-computed numbers.
 */
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Money } from '@/components/ui/Money';
import { Heading } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

/** Count tile tone — drives the swatch + value emphasis (token classes only). */
type Tone = 'new' | 'returning' | 'unclassified' | 'low' | 'mid' | 'high' | 'credit' | 'paypal' | 'other';

const TONE_SWATCH: Record<Tone, string> = {
  new: 'bg-status-blue',
  returning: 'bg-status-green',
  unclassified: 'bg-ink-muted',
  low: 'bg-status-warning',
  mid: 'bg-status-blue',
  high: 'bg-status-green',
  credit: 'bg-accent',
  paypal: 'bg-status-blue',
  other: 'bg-ink-muted',
};

export function UnknownBucketPanel({ breakdown }: { breakdown: UnknownBucketBreakdown }) {
  if (breakdown.unknownOrders === 0) return null;
  const { newVsReturning: nvr, aovBands, byStore, byPaymentCategory: pay } = breakdown;

  return (
    <section
      data-testid="unknown-bucket-panel"
      dir="rtl"
      className="overflow-hidden rounded-xl border border-glass-edge bg-glass-2"
    >
      {/* header band — title + honest framing + totals */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-glass-edge bg-status-warningBg px-4 py-3">
        <div className="min-w-0">
          <Heading level="panel" as="h3" className="flex items-center gap-1.5 text-status-warningFg">
            <HelpCircle size={15} aria-hidden />
            פירוק הבלתי-מזוהה
          </Heading>
          <p className="mt-1 max-w-md text-[11px] leading-relaxed text-ink-secondary">
            ההזמנות שמקור-ההפניה שלהן לא נקלט (ערוץ ישיר · חסר UTM · דפדפן חוסם).{' '}
            <b className="text-ink">תיאור בלבד</b> — לא חלוקה-מחדש לערוצים.
          </p>
        </div>
        <dl className="flex flex-none gap-5 text-end">
          <div>
            <dt className="text-[10.5px] font-semibold text-ink-muted">הזמנות</dt>
            <dd className="text-lg font-extrabold text-ink">
              <bdi dir="ltr" className="tabular-nums">{breakdown.unknownOrders}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold text-ink-muted">הכנסה</dt>
            <dd
              data-testid="unknown-bucket-revenue"
              className="tabular-nums text-lg font-extrabold text-ink"
            >
              <Money value={breakdown.unknownRevenueCad} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="space-y-4 px-4 py-3.5">
        {/* new vs returning */}
        <Block title="חדשים מול חוזרים" desc="לפי לקוח Shopify · בתוך הבלתי-מזוהה">
          <div className="grid grid-cols-3 gap-2.5">
            <Stat tone="new" label="חדשים" value={nvr.new} />
            <Stat tone="returning" label="חוזרים" value={nvr.returning} />
            <Stat tone="unclassified" label="לא מסווג" value={nvr.unclassifiable} />
          </div>
        </Block>

        {/* AOV bands — operator-locked edges: <50 / 50–70 / >70 */}
        <Block title="סלי-קנייה (AOV)" desc="פילוח לפי גובה ההזמנה · בלתי-מזוהה">
          <div className="grid grid-cols-3 gap-2.5">
            <Stat tone="low" label="AOV נמוך" range="<50" value={aovBands.low} />
            <Stat tone="mid" label="AOV בינוני" range="50–70" value={aovBands.mid} />
            <Stat tone="high" label="AOV גבוה" range=">70" value={aovBands.high} />
          </div>
        </Block>

        {/* payment category */}
        <Block title="אמצעי-תשלום" desc="לפי gateway · בלתי-מזוהה">
          <div className="grid grid-cols-3 gap-2.5">
            <Stat tone="credit" label="אשראי" value={pay.credit} />
            <Stat tone="paypal" label="PayPal" value={pay.paypal} />
            <Stat tone="other" label="אחר" value={pay.other} />
          </div>
        </Block>

        {/* per-store list */}
        <Block title="פילוח לפי חנות" desc="הבלתי-מזוהה בכל חנות">
          <ul className="space-y-2">
            {byStore.map((s) => (
              <li
                key={s.store}
                className="flex items-center justify-between gap-3 rounded-lg border border-glass-edge bg-glass-1 px-3 py-2"
              >
                <span className="truncate text-[13px] font-bold text-ink">{s.store}</span>
                <span className="flex flex-none items-center gap-1.5 text-end">
                  <span className="text-[10px] font-semibold text-ink-muted">הזמנות</span>
                  <bdi dir="ltr" className="tabular-nums text-sm font-extrabold text-ink">{s.orders}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </Block>

        {/* honest-framing disclaimer */}
        <div className="flex items-start gap-2 rounded-lg border border-glass-edge bg-accent-bg px-3 py-2.5">
          <AlertTriangle size={15} aria-hidden className="mt-0.5 flex-none text-status-warningFg" />
          <p className="text-[11px] leading-relaxed text-ink-secondary">
            <b className="text-ink">מסגור ישר:</b> הפנל מתאר את ההזמנות הבלתי-מזוהות — מי הלקוח, גודל הסל,
            אמצעי-התשלום ובאיזו חנות. הוא <b className="text-ink">אינו</b> מנחש לאיזה ערוץ הן שייכות ו
            <b className="text-ink">אינו</b> מחלק-מחדש את החלק הבלתי-מזוהה לערוצים — ה-ROAS לכל ערוץ נשאר כפי שהוא.
          </p>
        </div>
      </div>
    </section>
  );
}

function Block({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[12px] font-bold text-ink">{title}</span>
        <span className="text-[10.5px] font-medium text-ink-muted">{desc}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({
  tone,
  label,
  range,
  value,
}: {
  tone: Tone;
  label: string;
  range?: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-glass-edge bg-glass-1 px-2.5 py-2 text-center">
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-ink-muted">
        <span className={cn('inline-block h-2 w-2 flex-none rounded-sm', TONE_SWATCH[tone])} aria-hidden />
        <span>{label}</span>
        {range && <bdi dir="ltr" className="text-ink-subtle">({range})</bdi>}
      </div>
      <div className="mt-1 text-lg font-extrabold text-ink">
        <bdi dir="ltr" className="tabular-nums">{value}</bdi>
      </div>
    </div>
  );
}
