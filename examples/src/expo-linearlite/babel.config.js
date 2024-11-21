module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
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
        },
      ],
      'nativewind/babel',
    ],
    plugins: [
      'babel-plugin-transform-vite-meta-env',
      '@babel/plugin-syntax-import-attributes',
    ],
  };
};
