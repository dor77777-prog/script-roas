import { PerStoreCards } from '@/components/PerStoreCards';
import { InsightsBoard } from '@/components/InsightsBoard';

type PerStoreProps = React.ComponentProps<typeof PerStoreCards>;
type InsightsBoardProps = React.ComponentProps<typeof InsightsBoard>;

export function HomePerStoreBand(props: {
  perStoreProps: PerStoreProps;
  insightsProps: InsightsBoardProps;
}) {
  return (
    <section aria-label="Per store" className="space-y-3">
      <header>
        <h2 className="text-sm font-medium text-ink">לפי חנות</h2>
      </header>
      <PerStoreCards {...props.perStoreProps} />
      <details className="group">
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">תובנות והמלצות</summary>
        <div className="pt-3">
          <InsightsBoard {...props.insightsProps} />
        </div>
      </details>
    </section>
  );
}
