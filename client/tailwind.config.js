/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: '#09090b',
        'canvas-pure': '#000000',
        surface: '#0a0a0c',
        'surface-card': 'rgba(24,24,27,0.5)',
        'border-dim': '#1c1c1f',
        'border-base': '#27272a',
        'border-strong': '#3f3f46',
        // Text hierarchy
        'text-primary': '#fafafa',
        'text-secondary': '#a1a1aa',
        'text-meta': '#71717a',
        'text-faint': '#52525b',
        // Severity — muted, non-neon
        'sev-critical': '#ef4444',
        'sev-critical-bg': 'rgba(239,68,68,0.08)',
        'sev-critical-border': 'rgba(239,68,68,0.2)',
        'sev-high': '#f97316',
        'sev-high-bg': 'rgba(249,115,22,0.08)',
        'sev-high-border': 'rgba(249,115,22,0.2)',
        'sev-medium': '#eab308',
        'sev-medium-bg': 'rgba(234,179,8,0.08)',
        'sev-medium-border': 'rgba(234,179,8,0.2)',
        'sev-low': '#22c55e',
        'sev-low-bg': 'rgba(34,197,94,0.06)',
        'sev-low-border': 'rgba(34,197,94,0.15)',
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
      },
      animation: {
        'fade-up': 'fadeUp 0.18s ease-out',
        'slide-right': 'slideRight 0.2s ease-out',
        'blink': 'blink 1.4s step-start infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
      },
    },
  },
  plugins: [],
}
