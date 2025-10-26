/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: 'selector',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter\\ UI',
          'SF\\ Pro\\ Display',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe\\ UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'Open\\ Sans',
          'Helvetica\\ Neue',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
    },
  },

  variants: {
    extend: {
      backgroundColor: ['checked'],
      borderColor: ['checked'],
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
}
