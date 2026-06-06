// dashboard-web/src/app/operator/page.tsx
//
// ניהול (Management) — operator console. Per D-D1, this is a sibling
// Next.js route (NOT a TabKey in the main dashboard's in-page tab nav).
//
// Task 23 (UI/UX Design-System Overhaul): restructured from a single long
// page into 4 Radix sub-tabs for better navigation:
//
//   - סנכרון  (Sync)     — SyncNowButtons, BackfillPicker, ManualOverridesCrud
//   - בריאות  (Health)   — TokenFailuresTable, TikTok disclaimer, MetaBucPanel, FreshnessPanel
//   - פעילות  (Activity) — StatusEventsFeed, CronTickSnapshotsViewer, JobsTable
//   - מסוכן   (Danger)   — WhatsappTestButtons, ResetData
//
// Design tokens (`max-w-7xl`, `text-ink-secondary`, etc.) follow S-8 (RTL +
// Hebrew) and D-D4 (match existing dashboard styling — no new tokens).

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { OperatorSecretBanner } from '@/components/operator/OperatorSecretBanner';
import { Heading } from '@/components/ui/Typography';
import { StatusPill } from '@/components/ui/StatusPill';
import { OperatorRefreshButton } from './OperatorRefreshButton';
import { SyncTab } from './SyncTab';
import { HealthTab } from './HealthTab';
import { ActivityTab } from './ActivityTab';
import { DangerTab } from './DangerTab';
import { AdStateTab } from './AdStateTab';

// Phase A (Task 15): MetaBucPanel + FreshnessPanel are async server components
// that fetch at request time. force-dynamic ensures operator's hard-refresh
// always re-runs the DB queries rather than serving a stale RSC payload.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ניהול — ROAS Dashboard',
};

// Task 5.1 (P1-21): "בריאות" is the new default tab. The first thing
// the operator sees when opening /operator is the freshness lag matrix +
// token failures, NOT the manual sync buttons. Sync remains immediately
// reachable as the second tab.
const TABS = [
  ['health', 'בריאות'],
  ['sync', 'סנכרון'],
  ['activity', 'פעילות'],
  ['danger', 'מסוכן'],
  ['ads', 'מצב פרסום'],
] as const;

export default function OperatorPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Heading level="display">ניהול</Heading>
          <div className="flex items-center gap-2">
            {/* Task 5.1 — top-level <StatusPill> rolls freshness % + open
                token-failures into one GREEN/YELLOW/RED chip so the operator
                can answer "is everything OK?" without scanning sub-tabs. */}
            <StatusPill />
            {/* Task 5.2 — manual <Refresh> button piggybacks on SWR's global
                mutate(): revalidates every operator sub-tab's data in one
                click instead of waiting for the next 15 s tick. */}
            <OperatorRefreshButton />
          </div>
        </div>
        <p className="text-ink-secondary text-sm mt-1">
          ניהול אוטומציה: ריצות Inngest, backfill, החלפות ידניות, ו-Sync.
        </p>
      </header>

      {/* Security hardening FIX 3: operator-secret entry/management.
          Renders when OPERATOR_SECRET env var is configured on the server.
          When env var is unset this banner is harmless — the gate is inactive
          and all /api/operator/* calls pass through without the header.
          The banner is always visible so the operator can manage the stored
          secret even when the gate is not enforced. */}
      <OperatorSecretBanner />

      <Tabs defaultValue="health" variant="underline" className="mt-6">
        <TabsList className="mb-6">
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="sync">
          <SyncTab />
        </TabsContent>
        <TabsContent value="health">
          <HealthTab />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab />
        </TabsContent>
        <TabsContent value="danger">
          <DangerTab />
        </TabsContent>
        <TabsContent value="ads">
          <AdStateTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
