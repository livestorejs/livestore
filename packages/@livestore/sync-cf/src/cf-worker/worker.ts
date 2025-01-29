import type { Env } from './durable-object.js'

export type CFWorker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
}

export const makeWorker = (): CFWorker => {
  return {
    fetch: async (request, env, _ctx) => {
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
}
