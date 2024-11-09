/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />

// import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
// import { Effect, HttpServer, Schema } from '@livestore/utils/effect'

import type { Env } from './durable-object.js'

export * from './durable-object.js'

// const handleRequest = (request: Request, env: Env) =>
//   HttpServer.router.empty.pipe(
//     HttpServer.router.get(
//       '/websocket',
//       Effect.gen(function* () {
//         // This example will refer to the same Durable Object instance,
//         // since the name "foo" is hardcoded.
//         const id = env.WEBSOCKET_SERVER.idFromName('foo')
//         const durableObject = env.WEBSOCKET_SERVER.get(id)

//         HttpServer.

//         // Expect to receive a WebSocket Upgrade request.
//         // If there is one, accept the request and return a WebSocket Response.
//         const headerRes = yield* HttpServer.request
//           .schemaHeaders(
//             Schema.Struct({
//               Upgrade: Schema.Literal('websocket'),
//             }),
//           )
//           .pipe(Effect.either)

//         if (headerRes._tag === 'Left') {
//           // return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
//           return yield* HttpServer.response.text('Durable Object expected Upgrade: websocket', { status: 426 })
//         }

//         HttpServer.response.empty

//         return yield* Effect.promise(() => durableObject.fetch(request))
//       }),
//     ),
//     HttpServer.router.catchAll((e) => {
//       console.log(e)
//       return HttpServer.response.empty({ status: 400 })
//     }),
//     (_) => HttpServer.app.toWebHandler(_)(request),
//     // request
//   )

// Worker
export default {
  fetch: async (request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url)
    const searchParams = url.searchParams
    const roomId = searchParams.get('room')

    if (roomId === null) {
      return new Response('Room ID is required', { status: 400 })
    }

    // This example will refer to the same Durable Object instance,
    // since the name "foo" is hardcoded.
    const id = env.WEBSOCKET_SERVER.idFromName(roomId)
    const durableObject = env.WEBSOCKET_SERVER.get(id)

    if (url.pathname.endsWith('/websocket')) {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
      }

      return durableObject.fetch(request)
    }

    return new Response(null, {
      status: 400,
      statusText: 'Bad Request',
      headers: {
        'Content-Type': 'text/plain',
      },
    })
  },
}
