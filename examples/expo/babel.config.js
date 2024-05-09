/* eslint-disable unicorn/prefer-module */
module.exports = (api) => {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'babel-plugin-transform-vite-meta-env',
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            // Effect depends on the ws package,
            // that is not supported on React Native runtime.
            // This alias replaces the ws to a client only ws lib,
            // that works on React Native.
            ws: require.resolve('./react-native-ws.js'),
          },
        },
      ],
    ],
  }
}
