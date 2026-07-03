/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './src/**/*.{css,js}'],
  theme: {
    extend: {
      colors: {
        wiom: {
          pink: '#E5178F',
          ink: '#111827'
        }
      },
      fontFamily: {
        sans: ['Noto Sans', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  }
};
