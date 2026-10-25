/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', 'Consolas', 'ui-monospace', 'monospace'],
        sans: ['Inter', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: '#4f8cff',
        secondary: '#8b5cf6',
        accent: '#22d3ee',
        // Gece mavisi katmanları
        darker: '#070d1a',   // en derin zemin
        dark: '#0b1426',     // paneller
        surface: '#111d33',  // kartlar
        // slate paletini lacivert tonlara çek (tüm bileşenleri etkiler)
        slate: {
          50: '#f1f5fb', 100: '#e2e9f5', 200: '#c7d3e8', 300: '#a3b4d0', 400: '#7889a8',
          500: '#566684', 600: '#364560', 700: '#243049', 800: '#18233a', 900: '#0d172b', 950: '#070d1a',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(79,140,255,0.35), 0 8px 30px -8px rgba(79,140,255,0.35)',
        glass: '0 10px 40px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}
