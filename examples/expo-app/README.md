## Notes

- Doesn't yet support Expo Web
  - [ ] Missing support for `expo-sqlite/next` on web
  - [ ] Bug: No support for `import.meta` on web (even when using babel plugin)
- Transactional state updates will only work with `RCT_NEW_ARCH_ENABLED=1` (i.e. `RCT_NEW_ARCH_ENABLED=1 pod install` in the `ios` directory)
- The app SQLite database is stored in the app's `Library` directory (e.g. `/Users/<USERNAME>/Library/Developer/CoreSimulator/Devices/<DEVICE_ID>/data/Containers/Data/Application/<APP_ID>/Documents/SQLite/app.db`)
  - Run `open $(xcrun simctl get_app_container booted dev.livestore.livestore-expo data)/Documents/SQLite` to open the directory in Finder

## Setup requirements

Set `export RCT_NEW_ARCH_ENABLED=1` in your shell
- Until Expo supports the bytecode SQLite flag out of the box, you have to use the dev build of the app (i.e. Expo Go is not yet supported).
  - `pnpm expo prebuild -p ios` (generates the `ios` Xcode project)
  - Optional: `xed ios` (to open the project in Xcode)

- Until Expo properly supports PNPM we also need the following
  - Some workarounds in `metra.config.js` + `@babel/runtime` in `package.json`
  - Extra dependencies in `package.json` for iOS `Release` builds
    ```json
    "expo-asset": "^9.0.2",
    "@react-native/assets-registry": "^0.74.0",
    "babel-preset-expo": "^10.0.1",
    ```
  - `"expo-modules-autolinking@1.10.3": "patches/expo-modules-autolinking@1.10.3.patch"`

## Running

```
pnpm ios
```
