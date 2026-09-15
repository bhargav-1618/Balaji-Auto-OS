/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: '#0a0a0a',
          900: '#111111',
          800: '#1a1a1a',
          700: '#222222',
          600: '#2b2b2b',
          500: '#333333',
          400: '#444444',
        },
        gold: {
          DEFAULT: '#d4af37',
          light: '#e8c84a',
          dark: '#b8962e',
          muted: 'rgba(212,175,55,0.15)',
          border: 'rgba(212,175,55,0.3)',
        },
      },
      fontFamily: {
        cinzel: ['Cinzel', 'serif'],
        montserrat: ['Montserrat', 'sans-serif'],
      },
      animation: {
        'pulse-red': 'pulse-red 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { backgroundColor: '#7f1d1d', boxShadow: '0 0 0 0 rgba(239,68,68,0.7)' },
          '50%': { backgroundColor: '#991b1b', boxShadow: '0 0 0 6px rgba(239,68,68,0)' },
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        slideUp: {
          from: { transform: 'translateY(8px)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
