## Setup requirements

- Until Expo supports the bytecode SQLite flag out of the box, you have to use the dev build of the app (i.e. Expo Go is not yet supported).
- In particular you need to set "Other C Flags" to `-DSQLITE_ENABLE_BYTECODE_VTAB`
  ![](https://i.imgur.com/juy2bjh.png)

- Until Expo properly supports PNPM we also need the following
  - Some workarounds in `metra.config.js`