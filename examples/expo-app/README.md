## Notes

- Doesn't yet support Expo Web
  - [ ] Missing support for `expo-sqlite/next` on web
  - [ ] Bug: No support for `import.meta` on web (even when using babel plugin)
- Transactional state updates will only work with `RCT_NEW_ARCH_ENABLED=1` (i.e. `RCT_NEW_ARCH_ENABLED=1 pod install` in the `ios` directory)
- The app SQLite database is stored in the app's `Library` directory (e.g. `/Users/<USERNAME>/Library/Developer/CoreSimulator/Devices/<DEVICE_ID>/data/Containers/Data/Application/<APP_ID>/Documents/SQLite/app.db`)
  - Run `open $(xcrun simctl get_app_container booted dev.livestore.livestore-expo data)/Documents/SQLite` to open the directory in Finder

## Setup requirements

Set `export RCT_NEW_ARCH_ENABLED=1` in your shell

- Until Expo properly supports PNPM we also need the following
  - Some workarounds in `metro.config.js` + `@babel/runtime` in `package.json`

## Running

livestore could run on Expo Go from Expo SDK 51. Just run `pnpm ios` or `pnpm android` to start the example app in Expo Go.

If you want to have a custom build, you could run `pnpm expo run:ios` or `pnpm expo run:android` to build the app locally.
