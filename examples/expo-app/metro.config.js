/* eslint-disable unicorn/prefer-module */

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true

addLiveStoreDevtoolsMiddleware(config, { schemaPath: './src/schema/index.ts' })

// console.log(config)
module.exports = config
