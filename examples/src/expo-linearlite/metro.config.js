const { withNativeWind } = require('nativewind/metro')
const path = require('node:path')
/* eslint-disable unicorn/prefer-module */

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Needed for monorepo setup (can be removed in standalone projects)
if (process.env.MONOREPO_ROOT) {
  config.watchFolders = [path.resolve(process.env.MONOREPO_ROOT)]
}

addLiveStoreDevtoolsMiddleware(config, {
  schemaPath: './src/livestore/schema.ts',
  viteConfig: (viteConfig) => {
    viteConfig.server.fs ??= {}
    viteConfig.server.fs.strict = false
    viteConfig.optimizeDeps ??= {}
    viteConfig.optimizeDeps.force = true
    return viteConfig
  },
})

module.exports = withNativeWind(config, { input: './src/global.css' })
