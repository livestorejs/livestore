module.exports = (api) => {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['babel-plugin-transform-vite-meta-env', '@babel/plugin-syntax-import-attributes'],
  }
}
