/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: {
      sm: '640px',
      // => @media (min-width: 640px) { ... }

      md: '768px',
      // => @media (min-width: 768px) { ... }

      lg: '1024px',
      // => @media (min-width: 1024px) { ... }

      xl: '1280px',
      // => @media (min-width: 1280px) { ... }

      '2xl': '1536px',
      // => @media (min-width: 1536px) { ... }
    },
    // color: {
    //   // gray: colors.trueGray,
    // },
    extend: {
      fontSize: {
        '2xs': '0.625rem',
      },
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
