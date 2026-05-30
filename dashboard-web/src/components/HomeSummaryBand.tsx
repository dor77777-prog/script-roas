import { HeroOverview } from '@/components/HeroOverview';
import { KpiCards } from '@/components/KpiCards';

type HeroProps = React.ComponentProps<typeof HeroOverview>;
type KpiProps = React.ComponentProps<typeof KpiCards>;

export function HomeSummaryBand(props: { heroProps: HeroProps; kpiProps: KpiProps }) {
  return (
    <section aria-label="Compare to yesterday" className="space-y-3">
      <header>
        <h2 className="text-sm font-medium text-ink">היום מול אתמול</h2>
        {/* Formula note — guards: רווח נטו = הכנסות − הוצאות − COGS − עמלות − עלויות קבועות */}
        <p className="text-xs text-ink-muted mt-0.5 font-mono ltr">
          ROAS = הכנסות / סך הוצאות פרסום   •   רווח נטו = הכנסות − הוצאות − COGS − עמלות − עלויות קבועות
        </p>
      </header>
      <HeroOverview {...props.heroProps} />
      <KpiCards {...props.kpiProps} />
    </section>
  );
}
