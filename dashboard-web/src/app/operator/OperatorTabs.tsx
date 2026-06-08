// dashboard-web/src/app/operator/OperatorTabs.tsx
//
// Client tab shell for the operator console. Extracted from page.tsx (which
// stays a server component so `metadata` + `dynamic` exports keep working) so
// the tab strip can be CONTROLLED — the active tab now lives in React state.
//
// Why controlled: Self-serve stores Phase 6a — the "מצב פרסום" (ad-state) tab
// shows "לא מחובר" for store×platform cells with no credentials. Each such cell
// offers a "חבר" link; clicking it must jump the operator to the "חנויות"
// credential-matrix tab. A controlled `value`/`onValueChange` is the simplest
// way to switch tabs programmatically (the shared <Tabs> wrapper already
// forwards both props to Radix). Without lifting the active tab into state the
// console was uncontrolled (defaultValue) and a child could not switch it.
//
// Deep store/platform focus inside חנויות was DEFERRED (see report): the
// ad-state matrix is keyed off legacy store-meta while חנויות is keyed off the
// DB store config, so a matrix store may not exist as an editable EDIT-mode
// store. A plain tab switch is robust and lands the operator on the matrix that
// already lists every store's missing platforms + connect buttons.

'use client';

import { useCallback, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { SyncTab } from './SyncTab';
import { HealthTab } from './HealthTab';
import { ActivityTab } from './ActivityTab';
import { DangerTab } from './DangerTab';
import { AdStateTab } from './AdStateTab';
import { StoresTab } from './StoresTab';
import { AttributionDiagTab } from './AttributionDiagTab';

// Task 5.1 (P1-21): "בריאות" is the default tab. Kept in sync with page.tsx's
// previous TABS array; "חנויות" is the credential-matrix tab the ad-state
// "חבר" link jumps to.
const TABS = [
  ['health', 'בריאות'],
  ['sync', 'סנכרון'],
  ['activity', 'פעילות'],
  ['danger', 'מסוכן'],
  ['ads', 'מצב פרסום'],
  ['stores', 'חנויות'],
  ['attribution-diag', 'אבחון סיווג'],
] as const;

export function OperatorTabs() {
  const [tab, setTab] = useState<string>('health');

  // Ad-state "חבר" link → land the operator on the חנויות credential matrix.
  // storeId/platform are accepted for a future deep-focus but unused today
  // (plain tab switch — see file header for why deep-focus is deferred).
  const onConnectStore = useCallback(() => {
    setTab('stores');
  }, []);

  return (
    <Tabs value={tab} onValueChange={setTab} variant="underline" className="mt-6">
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
        <AdStateTab onConnect={onConnectStore} />
      </TabsContent>
      <TabsContent value="stores">
        <StoresTab />
      </TabsContent>
      <TabsContent value="attribution-diag">
        <AttributionDiagTab />
      </TabsContent>
    </Tabs>
  );
}
