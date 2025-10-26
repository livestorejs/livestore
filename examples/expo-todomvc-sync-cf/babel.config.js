module.exports = (api) => {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins: ['babel-plugin-transform-vite-meta-env', '@babel/plugin-syntax-import-attributes'],
  }
}
