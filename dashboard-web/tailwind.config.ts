import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#fafbfc',
        surface: '#ffffff',
        surfaceMuted: '#f3f4f6',
        border: '#e5e7eb',
        primary: { DEFAULT: '#1c4587', light: '#3b6cb3', dark: '#0f2a4f' },
        roas: {
          red: '#dc2626',
          redBg: '#fee2e2',
          orange: '#ea8c1f',
          orangeBg: '#ffedd5',
          green: '#16a34a',
          greenBg: '#dcfce7',
          blue: '#1d4ed8',
          blueBg: '#dbeafe',
        },
        text: {
          primary: '#0f172a',
          secondary: '#475569',
          muted: '#94a3b8',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Heebo', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        cardHover: '0 4px 12px 0 rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
