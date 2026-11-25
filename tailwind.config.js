/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F8FAFC',
        surface: '#FFFFFF',
        ink: {
          primary: '#0F172A',
          secondary: '#334155',
          muted: '#475569',
        },
        brand: {
          teal: '#115E59',
          'teal-light': '#CCFBF1',
          'teal-dark': '#042F2E',
        },
        taken: {
          DEFAULT: '#166534',
          bg: '#DCFCE7',
        },
        snooze: {
          DEFAULT: '#B45309',
          text: '#92400E',
          bg: '#FEF3C7',
        },
        alert: {
          DEFAULT: '#991B1B',
          bg: '#FEF2F2',
          chip: '#FEE2E2',
        },
        due: {
          DEFAULT: '#1E40AF',
          bg: '#DBEAFE',
        },
        pending: {
          DEFAULT: '#075985',
          bg: '#E0F2FE',
        },
        focus: '#0284C7',
      },
      minHeight: {
        touch: '44px',
        'elderly-taken': '68px',
        'elderly-snooze': '52px',
      },
      minWidth: {
        touch: '44px',
        'elderly-taken': '220px',
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
      },
      keyframes: {
        'pulse-border': {
          '0%, 100%': { boxShadow: '0 0 0 0px rgba(17, 94, 89, 0.0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(17, 94, 89, 0.25)' },
        },
      },
      animation: {
        'pulse-border': 'pulse-border 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
