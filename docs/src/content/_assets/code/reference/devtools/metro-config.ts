// @noErrors
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

const config = getDefaultConfig(__dirname)

addLiveStoreDevtoolsMiddleware(config, { schemaPath: './src/livestore/schema.ts' })

module.exports = config
