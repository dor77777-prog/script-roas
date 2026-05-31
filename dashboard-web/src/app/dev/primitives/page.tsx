// dashboard-web/src/app/dev/primitives/page.tsx
//
// Task 6.3 — canonical primitive showcase used by the Playwright visual-
// regression gate. Every export from src/components/ui/* renders here in
// each of its key variants, so a single full-page screenshot
// (`primitives.png` in tests/visual/states.spec.ts) covers the entire
// design-system surface in one shot.
//
// IMPORTANT constraints (per [[ui-ux-overhaul-plan]] and the task brief):
//   • Snapshot-friendly only — no live network primitives. StatusPill,
//     OperatorRefreshButton, etc. fetch real APIs and would render an
//     unstable "loading…" → "OK" transition that defeats the gate. They
//     are intentionally NOT included on this page.
//   • RTL + Hebrew labels match the rest of the app so the snapshot reflects
//     production typography (Heebo / Rubik fall-back chains).
//   • One section per primitive, separated by <hr>. Section IDs let
//     state-specific specs (sidebar-collapsed / freshness-fresh / etc.)
//     scope screenshots to the right sub-region without re-snapshotting
//     the whole page.

'use client';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { PageScope } from '@/components/ui/PageScope';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import { Sparkline } from '@/components/ui/Sparkline';
import { Stat } from '@/components/ui/Stat';
import { Switch } from '@/components/ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/Tooltip';
import { Heading, Text } from '@/components/ui/Typography';
import { AiInsightPill } from '@/components/ui/AiInsightPill';
import { InsightCard } from '@/components/ui/InsightCard';
import { PageSynthesis } from '@/components/ui/PageSynthesis';

// Static ISOs so the FreshnessBadge component renders deterministic stages
// regardless of when the snapshot is taken. The thresholds in
// lib/freshness/useStaleness.ts are 15 min (fresh→aging) and 30 min
// (aging→stale); the timestamps below stay safely inside each bucket
// relative to a 2026-05-31 baseline, but the snapshot only ever runs
// against `new Date()` so we layer in a small jitter buffer using a very
// old timestamp for stale.
const FRESH_ISO = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
const AGING_ISO = new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min ago
const STALE_ISO = new Date(Date.now() - 90 * 60_000).toISOString(); // 90 min ago

export default function PrimitivesPage() {
  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <main
        data-testid="primitives-canvas"
        className="max-w-7xl mx-auto px-6 py-8 space-y-10"
      >
        <header className="space-y-2">
          <Heading level="display">Design-System Primitives</Heading>
          <Text tone="muted">
            Snapshot canvas — every UI primitive in every main variant.
          </Text>
        </header>

        <Section id="typography" title="Typography (Heading / Text)">
          <div className="space-y-2">
            <Heading level="display">Display H1</Heading>
            <Heading level="hero">Hero H1</Heading>
            <Heading level="section">Section H2</Heading>
            <Heading level="panel">Panel H3</Heading>
            <Heading level="label">Label eyebrow</Heading>
          </div>
          <div className="space-y-1 mt-4">
            <Text>Default body text — the canonical paragraph treatment.</Text>
            <Text tone="secondary">Secondary body text — subtitle.</Text>
            <Text tone="muted">Muted body text — captions, hints.</Text>
            <Text tone="subtle">Subtle body text — meta rows.</Text>
          </div>
        </Section>

        <Section id="button" title="Button">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section id="badge" title="Badge (tone palette)">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="red">red</Badge>
            <Badge tone="orange">orange</Badge>
            <Badge tone="green">green</Badge>
            <Badge tone="blue">blue</Badge>
            <Badge tone="gray">gray</Badge>
            <Badge tone="warning">warning</Badge>
          </div>
        </Section>

        <Section id="platform-badge" title="PlatformBadge">
          <div className="flex flex-wrap items-center gap-3">
            <PlatformBadge platform="meta" />
            <PlatformBadge platform="google" />
            <PlatformBadge platform="tiktok" />
            <PlatformBadge platform="organic" />
            <PlatformBadge platform="shopify" />
          </div>
        </Section>

        <Section id="freshness" title="FreshnessBadge">
          <div className="flex flex-wrap items-center gap-3">
            <FreshnessBadge updatedAt={FRESH_ISO} testId="freshness-fresh" />
            <FreshnessBadge updatedAt={AGING_ISO} testId="freshness-aging" />
            <FreshnessBadge updatedAt={STALE_ISO} testId="freshness-stale" />
            <FreshnessBadge updatedAt={null} testId="freshness-missing" />
          </div>
        </Section>

        <Section id="card-bands" title="Card — V4 band states">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(['red', 'orange', 'green', 'blue'] as const).map((b) => (
              <Card key={b} band={b} data-testid={`card-band-${b}`}>
                <CardHeader>
                  <CardTitle>{`Band: ${b}`}</CardTitle>
                </CardHeader>
                <CardBody>
                  <Text tone="muted">3-px glow + chroma tint per V4 spec.</Text>
                </CardBody>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="card-freshness" title="Card — freshness desaturation">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card freshness="fresh" data-testid="card-freshness-fresh">
              <CardHeader>
                <CardTitle>fresh</CardTitle>
                <CardDescription>Full saturation.</CardDescription>
              </CardHeader>
            </Card>
            <Card freshness="aging" data-testid="card-freshness-aging">
              <CardHeader>
                <CardTitle>aging</CardTitle>
                <CardDescription>Mild desaturation.</CardDescription>
              </CardHeader>
            </Card>
            <Card freshness="stale" data-testid="card-freshness-stale">
              <CardHeader>
                <CardTitle>stale</CardTitle>
                <CardDescription>Heavy desaturation.</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </Section>

        <Section id="stat" title="Stat (density + accent)">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Spend" value="$1,240" accent="negative" />
            <Stat label="Revenue" value="$4,820" accent="positive" />
            <Stat label="Orders" value="64" />
            <Stat label="AOV" value="$75.31" accent="attention" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <Stat label="Compact" value="42" density="compact" />
            <Stat label="Regular" value="420" density="regular" />
            <Stat label="Hero" value="4,200" density="hero" />
          </div>
        </Section>

        <Section id="forms" title="Input / NativeSelect / Textarea / Switch">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            <Input placeholder="חיפוש קמפיין" />
            <Input placeholder="עם שגיאה" error="ערך לא חוקי" />
            <NativeSelect>
              <option>uzoshop</option>
              <option>zolplus</option>
              <option>usmile360</option>
            </NativeSelect>
            <NativeSelect error>
              <option>חסר ערך</option>
            </NativeSelect>
            <Textarea placeholder="הערה חופשית" rows={3} />
            <div className="flex items-center gap-3">
              <Switch defaultChecked />
              <Text tone="muted">Switch (checked)</Text>
            </div>
          </div>
        </Section>

        <Section id="tabs" title="Tabs (pill + underline)">
          <div className="space-y-4">
            <Tabs defaultValue="a">
              <TabsList>
                <TabsTrigger value="a">בית</TabsTrigger>
                <TabsTrigger value="b">P&amp;L</TabsTrigger>
                <TabsTrigger value="c">קמפיינים</TabsTrigger>
              </TabsList>
              <TabsContent value="a">
                <Text tone="muted">Pill content A.</Text>
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="a" variant="underline">
              <TabsList>
                <TabsTrigger value="a">מגמות</TabsTrigger>
                <TabsTrigger value="b">היסטוריה</TabsTrigger>
              </TabsList>
              <TabsContent value="a">
                <Text tone="muted">Underline content A.</Text>
              </TabsContent>
            </Tabs>
          </div>
        </Section>

        <Section id="tooltip" title="Tooltip">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="secondary">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent side="top">tooltip content</TooltipContent>
          </Tooltip>
        </Section>

        <Section id="page-scope" title="PageScope">
          <PageScope
            store="uzoshop"
            platform="Meta"
            rangeLabel="30 ימים"
            currency="CAD"
          />
        </Section>

        <Section id="page-synthesis" title="PageSynthesis">
          <PageSynthesis text="ROAS ב-3.2 — הכנסות גדלו 12% השבוע, הוצאות יציבות." />
          <PageSynthesis
            text="ביצועים חלשים — ROAS צנח מתחת ל-2.0 ב-3 קמפיינים."
            confidence="low"
          />
        </Section>

        <Section id="ai-insight-pill" title="AiInsightPill">
          <AiInsightPill>קמפיין Meta-001 מוביל ב-ROAS השבוע (3.8).</AiInsightPill>
        </Section>

        <Section id="insight-card" title="InsightCard (tones)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
            <InsightCard tone="warning" title="אזהרה">
              ROAS מתחת ל-2.0 בקמפיין X
            </InsightCard>
            <InsightCard tone="success" title="הצלחה">
              קמפיין Y עבר את הסף השבועי
            </InsightCard>
            <InsightCard tone="info" title="מידע">
              נתוני TikTok עודכנו בלילה
            </InsightCard>
            <InsightCard tone="neutral" title="ניטרלי">
              אין שינוי משמעותי
            </InsightCard>
          </div>
        </Section>

        <Section id="sparkline" title="Sparkline (tones)">
          <div className="flex flex-wrap items-center gap-4">
            <Sparkline data={[1, 3, 2, 5, 4, 7, 6]} tone="green" />
            <Sparkline data={[7, 5, 6, 3, 4, 1, 2]} tone="red" />
            <Sparkline data={[2, 3, 4, 5, 6, 5, 4]} tone="orange" />
            <Sparkline data={[1, 2, 3, 4, 5, 6, 7]} tone="blue" />
            <Sparkline data={[3, 3, 3, 3, 3, 3, 3]} tone="gray" />
          </div>
        </Section>
      </main>
    </TooltipProvider>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-testid={`section-${id}`} className="space-y-3">
      <Heading level="section">{title}</Heading>
      <div>{children}</div>
      <hr className="border-glass-edge" />
    </section>
  );
}
