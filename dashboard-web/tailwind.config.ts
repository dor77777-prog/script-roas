import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * Wave-1 Task 1.2 token palette — single source of truth.
 *
 *   canvas / glass / band / chart / store / accent / status / ink
 *
 * Every Tailwind color alias below resolves to a `var(--*)` token defined in
 * src/app/globals.css. The Phase-13 hex palette (`primary`, `roas`, `text`,
 * `surface*`, `border*`) AND the Task-1.1 interim aliases (`elevated`,
 * `elevated2`, `overlay`, `line.*`) are GONE — `local/no-legacy-tailwind-class`
 * + the `tokenSweep` vitest regression guard block any regression at lint /
 * test time.
 *
 *   - Numbers everywhere use tabular-nums; display weights stay lighter
 *     (300-500) so the dashboard reads "editorial / fintech".
 *   - Shadows: 3 blessed tokens (glass / overlay / sheet) — see Task 1.7.
 *   - Border radius scale: 6 (inputs) · 8 (buttons) · 12 (cards) · 16 (hero).
 *   - Easing uses ease-out-cubic only; no bounce/elastic.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  // Dual-mode mesh re-skin. The CSS tokens are inverted vs the `dark:`
  // selector below: `:root` carries the DARK token set and
  // `[data-theme="light"]` overrides it for light. This `dark:` variant
  // (kept, do not remove) still targets `[data-theme="dark"]` for the few
  // `dark:`-prefixed utilities; absence of `data-theme` resolves to the
  // :root (dark) tokens by default.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ---- Canvas: fixed body background. Dual-mode — deep blue-violet on
        //      dark (:root), near-white cool wash on light ([data-theme="light"]).
        canvas: {
          DEFAULT: 'var(--canvas-1)',
          1:       'var(--canvas-1)',
          2:       'var(--canvas-2)',
        },

        // ---- Glass: 3-layer OPAQUE mesh surface stack + 2 edge tones, tuned
        //      per theme (navy stops on dark, white-ish on light). Used for
        //      cards, drawers, table headers, hover/active surfaces. NOTE: the
        //      `glass` name is legacy — these are flat opaque mesh surfaces,
        //      not translucent glass (rename to `surface` deferred). The two
        //      edge tones (default + hot) replace the old line.* border family
        //      — `border-glass-edge-hot` is the accent rim (violet dark / teal
        //      light) used on hover/focus/active surfaces.
        glass: {
          1: 'var(--glass-1)',
          2: 'var(--glass-2)',
          3: 'var(--glass-3)',
          edge:      'var(--glass-edge)',
          'edge-hot': 'var(--glass-edge-hot)',
        },

        // ---- Surface: named opaque-mesh surfaces beyond the glass stack.
        //      `elevated-1` aliases the existing CSS var (mid stop);
        //      `sunken` (Wave 0) is the recessed-well surface for seg /
        //      goalbar / health tracks + kstrip insets. Both flip per theme
        //      via their --surface-* vars.
        surface: {
          'elevated-1': 'var(--surface-elevated-1)',
          sunken:       'var(--surface-sunken)',
        },

        // ---- Band: ROAS-grading signal palette (red < 2.0, orange 2.0-2.7,
        //      green 2.7-3.0, blue > 3.0, gray for no-data). Tuned per theme
        //      (dark + light values in globals.css) for ≥4.5:1 contrast at
        //      stroke ≥2px on each canvas.
        //      Task 1.3 owns the data-band="..." attribute consumers.
        band: {
          red:    'var(--band-red)',
          orange: 'var(--band-orange)',
          green:  'var(--band-green)',
          blue:   'var(--band-blue)',
          gray:   'var(--band-gray)',
        },

        // ---- Chart: platform-brand-mirrored palette. See globals.css for
        //      the per-platform hue rationale (Meta blue, Google amber,
        //      TikTok red, organic teal, Shopify green).
        chart: {
          meta:    'var(--chart-platform-meta)',
          google:  'var(--chart-platform-google)',
          tiktok:  'var(--chart-platform-tiktok)',
          organic: 'var(--chart-platform-organic)',
          shopify: 'var(--chart-platform-shopify)',
        },

        // ---- Store: per-store hues for Per-Store row + store badges.
        store: {
          uzo: 'var(--store-uzo)',
          usm: 'var(--store-usm)',
          3:   'var(--store-3)',
        },

        // ---- Accent: brand violet (Q2). Used for buttons, focus rings,
        //      active-state highlights, logo gradient.
        accent: {
          DEFAULT: 'var(--accent)',
          deep:    'var(--accent-deep)',
          fg:      'var(--accent-fg)',
          // Wave 0 mesh tints. `soft` = icon-chip bg / operator accent-panel /
          // mapped-product pill; `bg` = alpha-safe replacement for the
          // bg-accent/NN tint sites (so the tint flips per theme).
          soft:    'var(--accent-soft)',
          bg:      'var(--accent-bg)',
        },

        // ---- Status: system-state semantics (token failures, sync errors,
        //      freshness chips). Distinct from --band-* — band = analytic
        //      grading, status = operational signal. Cross-pollination is
        //      blocked by local/no-cross-palette-import.
        status: {
          red:       'var(--status-red)',
          redBg:     'var(--status-red-bg)',
          redFg:     'var(--status-red-fg)',
          orange:    'var(--status-orange)',
          orangeBg:  'var(--status-orange-bg)',
          orangeFg:  'var(--status-orange-fg)',
          green:     'var(--status-green)',
          greenBg:   'var(--status-green-bg)',
          greenFg:   'var(--status-green-fg)',
          blue:      'var(--status-blue)',
          blueBg:    'var(--status-blue-bg)',
          blueFg:    'var(--status-blue-fg)',
          gray:      'var(--status-gray)',
          grayBg:    'var(--status-gray-bg)',
          grayFg:    'var(--status-gray-fg)',
          warning:   'var(--status-warning)',
          warningBg: 'var(--status-warning-bg)',
          warningFg: 'var(--status-warning-fg)',
        },

        // ---- Ink: 4-stop foreground stack. `text-ink` is body / numbers /
        //      headings; -secondary is subtitle text; -muted is metadata;
        //      -subtle is least-prominent meta (e.g. timestamps in tooltips).
        ink: {
          DEFAULT:   'var(--text)',
          secondary: 'var(--text-2)',
          muted:     'var(--text-muted)',
          subtle:    'var(--text-subtle)',
        },

        // ---- Scrim: modal / overlay dim layer (Wave 0). Tokenised so
        //      `bg-scrim` flips per theme instead of a raw bg-black/60.
        scrim: 'var(--scrim)',
      },

      fontFamily: {
        sans: [
          'var(--font-heebo)',
          'var(--font-rubik)',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Arial',
          'sans-serif',
        ],
        // `font-numeric` is the new utility used by .tabular-nums. Heebo lacks
        // a real `tnum` feature; Rubik has it. By giving the numeric class a
        // Rubik-first chain we make the tnum declaration actually resolve to
        // a tabular substitution instead of silently no-op-ing.
        numeric: [
          'var(--font-rubik)',
          'var(--font-heebo)',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'var(--font-geist-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },

      fontSize: {
        // Tighter than defaults; letter-spacing pulls in on display sizes.
        '2xs':  ['0.6875rem', { lineHeight: '0.95rem',  letterSpacing: '0.01em' }],
        'xs':   ['0.75rem',   { lineHeight: '1.05rem',  letterSpacing: '0.005em' }],
        'sm':   ['0.875rem',  { lineHeight: '1.3rem' }],
        'base': ['1rem',      { lineHeight: '1.55rem' }],
        'lg':   ['1.0625rem', { lineHeight: '1.625rem', letterSpacing: '-0.005em' }],
        'xl':   ['1.25rem',   { lineHeight: '1.75rem',  letterSpacing: '-0.01em' }],
        '2xl':  ['1.5rem',    { lineHeight: '1.85rem',  letterSpacing: '-0.014em' }],
        '3xl':  ['1.875rem',  { lineHeight: '2.125rem', letterSpacing: '-0.018em' }],
        '4xl':  ['2.25rem',   { lineHeight: '2.5rem',   letterSpacing: '-0.022em' }],
        '5xl':  ['3rem',      { lineHeight: '3.25rem',  letterSpacing: '-0.026em' }],
      },

      boxShadow: {
        // Wave-1 Task 1.7 — 3 blessed shadows. The prior
        // xs/sm/card/cardHover/elevated/focus/innerHighlight ladder is GONE;
        // any `shadow-sm|md|lg|xl|card|elevated|inner` regression resolves
        // to nothing (silently flat surface). Focus rings live on the global
        // `:focus-visible` rule in globals.css.
        glass:   'var(--shadow-glass)',
        overlay: 'var(--shadow-overlay)',
        sheet:   'var(--shadow-sheet)',
        // Wave 0 — lighter button/pill drop. Flips per theme via --shadow-soft.
        soft:    'var(--shadow-soft)',
      },

      borderRadius: {
        // Wave-1 Task 1.8 — semantic radius scale, sourced from
        // `--radius-*` vars in globals.css. New components consume the
        // semantic tokens (rounded-{control|chip|card|hero|pill}); we
        // intentionally LEAVE the size aliases (sm/md/lg/xl/2xl/3xl) in
        // place at their Phase-13 numeric values because ~370 existing
        // consumers reference them and migrating in a single task would
        // dwarf the shadow sweep (Task 1.7, ~40 sites) at unacceptable
        // visual-regression risk. Migration happens progressively as
        // components are touched in Waves 2-5. NOTE: the mesh re-skin
        // bumped the semantic radii toward the mockup, so they have now
        // DIVERGED from the size aliases (no longer 1:1). Current mapping:
        //   rounded-control = 10px (var) ; nearest size alias = lg
        //   rounded-chip    = 11px (var) ; between md and lg (no exact alias)
        //   rounded-card    = 18px (var) ; equals size alias 2xl
        //   rounded-full ↔ rounded-pill
        sm:    '0.375rem',
        DEFAULT: '0.5rem',
        md:    '0.5rem',
        lg:    '0.625rem',   // 10 — for buttons / chips
        xl:    '0.875rem',   // 14 — for cards
        '2xl': '1.125rem',   // 18 — for hero sections
        '3xl': '1.5rem',
        // Semantic tokens (preferred for new code):
        control: 'var(--radius-control)',
        chip:    'var(--radius-chip)',
        card:    'var(--radius-card)',
        hero:    'var(--radius-hero)',
        pill:    'var(--radius-pill)',
      },

      transitionDuration: {
        // Wave-1 Task 1.8 — semantic motion scale, sourced from
        // `--motion-*` vars. New code prefers
        // duration-{snap|fast|base|slow|large}; the existing
        // duration-200 / duration-500 sites (7 total) are folded into
        // duration-fast / duration-slow as components are touched.
        // DEFAULT remains 180 ms so `transition` (no duration suffix)
        // still feels right.
        DEFAULT: 'var(--motion-fast)',
        snap:    'var(--motion-snap)',
        fast:    'var(--motion-fast)',
        base:    'var(--motion-base)',
        slow:    'var(--motion-slow)',
        large:   'var(--motion-large)',
      },

      transitionTimingFunction: {
        // ease-out-cubic; no bounce. `out` is now sourced from
        // `--ease-out` (a slightly different cubic — 0.16,1,0.3,1 —
        // tuned for the mockup's "snap-to-rest" feel). DEFAULT keeps
        // the old curve so existing `transition` calls don't shift
        // their micro-easing under our feet.
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        out: 'var(--ease-out)',
      },

      keyframes: {
        'fade-in':    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in':    'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in-up': 'fade-in-up 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer:      'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
