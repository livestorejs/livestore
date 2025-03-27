---
title: Expo Adapter
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


