/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07070c', 900: '#0b0b12', 850: '#101019', 800: '#16161f', 700: '#21212d', 600: '#2e2e3d', 500: '#4a4a5c' },
        gold: { 300: '#fde68a', 400: '#f5c518', 500: '#e0b000' },
        seat: { standard: '#3b82f6', premium: '#a855f7', recliner: '#14b8a6' },
      },
      fontFamily: { display: ['"Bebas Neue"', 'Impact', 'sans-serif'], sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
