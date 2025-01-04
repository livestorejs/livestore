const { withNativeWind } = require('nativewind/metro')
const path = require('node:path')
/* eslint-disable unicorn/prefer-module */

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_conditionNames = ['require', 'default']

// Needed for monorepo setup (can be removed in standalone projects)
const projectRoot = __dirname
const monorepoRoot = process.env.MONOREPO_ROOT
  ? path.resolve(process.env.MONOREPO_ROOT)
  : path.resolve(projectRoot, '../../..')

addLiveStoreDevtoolsMiddleware(config, {
  schemaPath: './src/livestore/schema.ts',
  viteConfig: (viteConfig) => {
    viteConfig.server.fs ??= {}
    // Point to Overtone monorepo root
    viteConfig.server.fs.allow.push(monorepoRoot)
    viteConfig.optimizeDeps.force = true
    return viteConfig
  },
})

module.exports = withNativeWind(config, { input: './src/global.css' })
