## Setup

- Set up project via `npx tiged --mode=git livestorejs/livestore/examples/expo-app`
- Run `pnpm install` to install the dependencies
- Set `export RCT_NEW_ARCH_ENABLED=1` in your shell to enable the new React Native architecture (required for transactional state updates)

## Running

The easiest way to run the app locally is using Expo Go. Just run `pnpm ios` or `pnpm android`.

You can open the LiveStore devtools by pressing `Shift+m` and select `@livestore/devtools-expo`.

### Custom builds

If you need a custom build, you could run `pnpm expo run:ios` or `pnpm expo run:android` to build the app locally.


## Database location

### With Expo Go

Run `open $(xcrun simctl get_app_container booted host.exp.Exponent data)/Documents/ExponentExperienceData/@$USER/livestore-expo/SQLite` to open the database in Finder.

### With custom builds

The app SQLite database is stored in the app's `Library` directory (e.g. `/Users/<USERNAME>/Library/Developer/CoreSimulator/Devices/<DEVICE_ID>/data/Containers/Data/Application/<APP_ID>/Documents/SQLite/app.db`)

Run `open $(xcrun simctl get_app_container booted dev.livestore.livestore-expo data)/Documents/SQLite` to open the directory in Finder

## Notes

- Until Expo properly supports PNPM we also need the following
  - Some workarounds in `metro.config.js` + `@babel/runtime` in `package.json`
- LiveStore doesn't yet support Expo Web (see [#130](https://github.com/livestorejs/livestore/issues/130))
