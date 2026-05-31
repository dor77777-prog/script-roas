import { Lightbulb } from 'lucide-react';
import { PerStoreCards } from '@/components/PerStoreCards';
import { InsightsBoard } from '@/components/InsightsBoard';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { Heading } from '@/components/ui/Typography';

type PerStoreProps = React.ComponentProps<typeof PerStoreCards>;
type InsightsBoardProps = React.ComponentProps<typeof InsightsBoard>;

export function HomePerStoreBand(props: {
  perStoreProps: PerStoreProps;
  insightsProps: InsightsBoardProps;
}) {
  return (
    <section aria-label="Per store" className="space-y-3">
      <header>
        <Heading level="section" className="font-medium">לפי חנות</Heading>
      </header>
      <PerStoreCards {...props.perStoreProps} />
      {/* Audit P1-8: was a hand-rolled <details> with raw summary text — now
          uses the polished CollapsibleSection primitive so glass treatment,
          chevron animation, and aria-expanded come for free. storageKey
          persists the open/closed state across reloads. */}
      <CollapsibleSection
        title="תובנות והמלצות"
        icon={<Lightbulb size={16} />}
        storageKey="home-per-store-insights"
      >
        <div className="p-4 sm:p-5">
          <InsightsBoard {...props.insightsProps} />
        </div>
      </CollapsibleSection>
    </section>
  );
}
