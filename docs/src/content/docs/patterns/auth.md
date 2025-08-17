---
title: Auth
sidebar:
  order: 21
---

LiveStore doesn't include built-in authentication or authorization support, but you can implement it in your app's logic.

## Pass an auth payload to the sync backend

Use the `syncPayload` store option to send a custom payload to your sync backend.

### Example

The following example sends the authenticated user's JWT to the server.

```tsx
<LiveStoreProvider
  schema={schema}
  storeId={storeId}
  syncPayload={{
    authToken: user.jwt, // Using a JWT
  }}
>
  ...
```

On the sync server, validate the token and allow or reject the sync based on the result. See the following example:

```ts
import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'
import * as jose from 'jose'

const JWT_SECRET = 'a-string-secret-at-least-256-bits-long'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message) => {
    console.log('onPush', message.batch)
  },
  onPull: async (message) => {
    console.log('onPull', message)
  },
}) {}

export default makeWorker({
  validatePayload: async (payload: any, context) => {
    const { storeId } = context
    const { authToken } = payload

    if (!authToken) {
      throw new Error('No auth token provided')
    }

    const user = await getUserFromToken(authToken)

    if (!user) {
      throw new Error('Invalid auth token')
    } else {
      // User is authenticated!
      console.log('Sync backend payload', JSON.stringify(user, null, 2))
    }

    // Check if token is expired
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired')
    }
  },
  enableCORS: true,
})

async function getUserFromToken(token: string): Promise<jose.JWTPayload | undefined> {
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
    return payload
  } catch (error) {
    console.log('⚠️ Error verifying token', error)
  }
}

async function checkUserAccess(payload: jose.JWTPayload, storeId: string): Promise<void> {
  // Check if user is authorized to access the store
}
```

The above example uses [`jose`](https://www.npmjs.com/package/jose), a popular JavaScript module that supports JWTs. It works across various runtimes, including Node.js, Cloudflare Workers, Deno, Bun, and others.

The `validatePayload` function receives the `authToken`, checks if the payload exists, and verifies that it's valid and hasn't expired. If all checks pass, sync continues as normal. If any check fails, the server rejects the sync.

The client app still works as expected, but saves data locally. If the user re-authenticates or refreshes the token later, LiveStore syncs any local changes made while the user was unauthenticated.
