// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true

// console.log('config', config)

config.watchFolders = [path.join(__dirname, '../../')]

// throw new Error('stop')

module.exports = config
