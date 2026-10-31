/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#7dd3fc', fg: '#ffffff' },
        ink: 'rgb(17 24 39 / <alpha-value>)',
      },
    },
  },
};
