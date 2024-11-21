const { withNativeWind } = require('nativewind/metro');

/* eslint-disable unicorn/prefer-module */

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['require', 'default'];

if (!process.env.CI && process.stdout.isTTY) {
  addLiveStoreDevtoolsMiddleware(config, { schemaPath: './livestore/schema.ts' });
}

// console.log(config)
module.exports = config;

module.exports = withNativeWind(config, { input: './global.css' });
