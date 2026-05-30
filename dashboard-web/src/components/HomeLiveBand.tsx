import { TodayLive } from '@/components/TodayLive';

type TodayLiveProps = React.ComponentProps<typeof TodayLive>;

export function HomeLiveBand(props: TodayLiveProps) {
  return (
    <section aria-label="Live" className="space-y-3">
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">עכשיו</h2>
        <span className="text-xs text-ink-muted">(אינטרא-יום)</span>
      </header>
      <TodayLive {...props} />
    </section>
  );
}
