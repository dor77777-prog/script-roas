import type { Config } from 'tailwindcss';

/**
 * Design tokens influenced by Stripe + Linear + Impeccable principles:
 *  - Body text is deep navy, never pure black.
 *  - Background is a cool-tinted off-white (#f6f9fc), not paper white.
 *  - Numbers everywhere use tabular-nums; display weights stay lighter (300-500)
 *    so the dashboard reads "editorial / fintech" rather than "marketing-bold".
 *  - Shadows are layered & cool-tinted (rgba(15, 31, 81, …)) — not flat black.
 *  - Border radius scale: 6 (inputs) · 8 (buttons) · 12 (cards) · 16 (hero).
 *  - Easing uses ease-out-cubic only; no bounce/elastic.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Cool-tinted surface stack — pure white feels harsh next to data.
        background:    '#f6f9fc',
        surface:       '#ffffff',
        surfaceMuted:  '#f0f4f9',
        surfaceSubtle: '#fafbfd',
        surfaceSunken: '#eef2f7',
        border:        '#d9e2ec',
        borderSubtle:  '#e7ecf2',
        borderStrong:  '#c4d0de',

        // Deep navy primary — refined, slightly more saturated than default.
        primary: {
          DEFAULT: '#0d3680',
          light:   '#3257ad',
          lighter: '#dde7f5',
          dark:    '#091c4a',
          50:  '#f0f5fd',
          100: '#dde7f5',
          200: '#b9cdec',
          300: '#8ba8de',
          400: '#5b81cd',
          500: '#3257ad',
          600: '#0d3680',
          700: '#0a285f',
          800: '#091c4a',
          900: '#06112f',
        },

        // ROAS semantic — kept the same hues but cleaner backgrounds.
        roas: {
          red:      '#dc2626',
          redBg:    '#fef0f0',
          orange:   '#d97706',
          orangeBg: '#fff5e3',
          green:    '#15803d',
          greenBg:  '#e8f6ed',
          blue:     '#1d4ed8',
          blueBg:   '#e3ecff',
        },

        // Text: deep navy ink, not pure black. Better on cool-tinted bg.
        text: {
          primary:   '#0d253d',
          secondary: '#3c4858',
          muted:     '#7a8a9a',
          subtle:    '#a8b5c2',
        },
      },

      fontFamily: {
        sans: [
          'Heebo',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
        // Cool-tinted, layered. Two-level Stripe-style.
        xs:   '0 1px 1px 0 rgba(15, 31, 81, 0.04)',
        sm:   '0 1px 2px 0 rgba(15, 31, 81, 0.05), 0 1px 1px 0 rgba(15, 31, 81, 0.04)',
        card: '0 1px 3px 0 rgba(15, 31, 81, 0.06), 0 1px 1px 0 rgba(15, 31, 81, 0.04)',
        cardHover:
              '0 4px 12px -2px rgba(15, 31, 81, 0.10), 0 2px 4px -1px rgba(15, 31, 81, 0.05)',
        elevated:
              '0 12px 32px -6px rgba(15, 31, 81, 0.12), 0 4px 8px -2px rgba(15, 31, 81, 0.06)',
        focus: '0 0 0 3px rgba(13, 54, 128, 0.18)',
        innerHighlight: 'inset 0 1px 0 0 rgba(255,255,255,0.6)',
      },

      borderRadius: {
        sm:    '0.375rem',
        DEFAULT: '0.5rem',
        md:    '0.5rem',
        lg:    '0.625rem',   // 10 — for buttons / chips
        xl:    '0.875rem',   // 14 — for cards
        '2xl': '1.125rem',   // 18 — for hero sections
        '3xl': '1.5rem',
      },

      transitionDuration: {
        DEFAULT: '180ms',
        slow:    '320ms',
      },

      transitionTimingFunction: {
        // ease-out-cubic; no bounce.
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
  plugins: [],
};

export default config;
