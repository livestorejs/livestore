const { withNativeWind } = require('nativewind/metro')
/* eslint-disable unicorn/prefer-module */

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_conditionNames = ['require', 'default']

addLiveStoreDevtoolsMiddleware(config, { schemaPath: './src/livestore/schema.ts' })

module.exports = withNativeWind(config, { input: './src/global.css' })
