/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
