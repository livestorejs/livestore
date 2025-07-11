process.env.EXPO_ROUTER_APP_ROOT = './src/app'

module.exports = (api) => {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // TODO: React compiler is not working because https://github.com/software-mansion/react-native-screens/issues/2302
          // 'react-compiler': {
          // Passed directly to the React Compiler Babel plugin.
          // compilationMode: 'strict',
          // panicThreshold: 'all_errors',
          // },
          // web: {
          //   'react-compiler': {
          // Web-only settings...
          // },
          // },
          unstable_transformImportMeta: true,
        },
      ],
    ],
    plugins: ['babel-plugin-transform-vite-meta-env', '@babel/plugin-syntax-import-attributes'],
  }
}
