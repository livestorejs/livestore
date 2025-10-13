---
title: Offline Support
---

- LiveStore supports offline data management out of the box. In order to make your app work fully offline, you might need to also consider the following:
  - Design your app in a way to treat the network as an optional feature (e.g. when relying on other APIs / external data)
  - Use service workers to cache assets locally (e.g. images, videos, etc.)

## Tracking connectivity

Use `store.networkStatus` to react to connectivity transitions. The subscribable emits every time the sync backend connection flips or the devtools latch simulates an offline state.

```ts
import { Effect, Stream } from 'effect'

const status = await store.networkStatus.pipe(Effect.runPromise)
if (status.isConnected === false) {
  console.warn('Sync backend offline since', new Date(status.timestampMs))
}

await store.networkStatus.changes.pipe(
  Stream.tap((next) => console.log('network status updated', next)),
  Stream.runDrain,
  Effect.scoped,
  Effect.runPromise,
)
```

When devtools close the sync latch to simulate an offline client, `status.devtools.latchClosed` is `true`, allowing you to differentiate between real and simulated outages. Remember to dispose of long-lived subscriptions using the Effect scope you already manage for your runtime.
