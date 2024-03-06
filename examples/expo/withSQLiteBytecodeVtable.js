/* eslint-disable unicorn/prefer-module */

const { withDangerousMod, withGradleProperties } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')

const BUILD_FLAGS = '-DSQLITE_ENABLE_BYTECODE_VTAB=1'

const withSQLiteBytecodeVtable = (config) => {
  config = withCustomBuildFlagsIos(config)
  config = withCustomBuildFlagsAndroid(config)
  return config
}

const withCustomBuildFlagsIos = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile')
      let contents = await fs.readFile(podfilePath, 'utf8')
      contents = contents.replace(
        /^(\s*react_native_post_install\(.*)$/m,
        `\
    # Enable SQLite bytecode vtable support
    installer.target_installation_results.pod_target_installation_results
      .each do |pod_name, target_installation_result|
      if pod_name == 'sqlite3'
        target_installation_result.native_target.build_configurations.each do |config|
          config.build_settings['OTHER_CFLAGS'] = '$(inherited)' unless config.build_settings['OTHER_CFLAGS']
          config.build_settings['OTHER_CFLAGS'] += ' ${BUILD_FLAGS}'
        end
      end
    end

$1`,
      )
      await fs.writeFile(podfilePath, contents)
      return config
    },
  ])
}

const withCustomBuildFlagsAndroid = (config) => {
  const PROPERTY_KEY = 'expo.sqlite.customBuildFlags'
  return withGradleProperties(config, (config) => {
    const gradleProperties = config.modResults

    const newProp = {
      type: 'property',
      key: PROPERTY_KEY,
      value: BUILD_FLAGS,
    }

    const oldPropIndex = gradleProperties.findIndex((prop) => prop.type === 'property' && prop.key === PROPERTY_KEY)
    if (oldPropIndex >= 0) {
      gradleProperties[oldPropIndex] = newProp
    } else {
      gradleProperties.push(newProp)
    }

    config.modResults = gradleProperties
    return config
  })
}

module.exports = withSQLiteBytecodeVtable