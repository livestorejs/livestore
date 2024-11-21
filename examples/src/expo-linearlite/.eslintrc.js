/* eslint-disable unicorn/prefer-module */
// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  plugins: ['eslint-plugin-react-compiler'],
  rules: {
    'react-compiler/react-compiler': 'error',
    'import/no-unresolved': 'off',
  },
}
