---
title: Expo Adapter
sidebar:
  order: 2
---

## Notes on Android

- By default, Android requires `https` (including WebSocket connections) when communicating with a sync backend.

To allow for `http` / `ws`, you can run `expo install expo-build-properties` and add the following to your `app.json` (see [here](https://docs.expo.dev/versions/latest/sdk/build-properties/#pluginconfigtypeandroid) for more information):

```json
{
  "expo": {
    "plugins": [
      "expo-build-properties",
      {
        "android": {
          "usesCleartextTraffic": true
        },
        "ios": {}
      }
    ]
  }
}
```


## Resetting local persistence

When iterating locally you can ask the Expo adapter to drop the on-device state and eventlog databases before booting:

```ts
import { makePersistedAdapter } from '@livestore/adapter-expo'

const resetPersistence = process.env.EXPO_PUBLIC_LIVESTORE_RESET === 'true'

const adapter = makePersistedAdapter({
  storage: { subDirectory: 'dev' },
  resetPersistence,
})
```

:::caution
Resetting persistence deletes all local LiveStore data for the configured store. This only clears data on the device and does not touch any connected sync backend. Make sure this flag is disabled in production builds.
:::


