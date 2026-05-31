import { TodayLive } from '@/components/TodayLive';
import { Heading } from '@/components/ui/Typography';

type TodayLiveProps = React.ComponentProps<typeof TodayLive>;

export function HomeLiveBand(props: TodayLiveProps) {
  return (
    <section aria-label="Live" className="space-y-3">
      <header className="flex items-center gap-2">
        <Heading level="section" className="font-medium">עכשיו</Heading>
        <span className="text-xs text-ink-muted">(אינטרא-יום)</span>
      </header>
      <TodayLive {...props} />
    </section>
  );
}
