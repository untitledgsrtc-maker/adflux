/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        subtle: 'var(--text-subtle)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--blue)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      backgroundImage: {
        'incentive': 'var(--gradient-incentive)',
        'incentive-soft': 'var(--gradient-incentive-soft)',
      },
      boxShadow: {
        'accent-glow': 'var(--accent-glow)',
      },
    },
  },
  plugins: [],
}
