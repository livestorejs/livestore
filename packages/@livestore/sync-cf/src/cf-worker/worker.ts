import type { Env } from './durable-object.js'

export type CFWorker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
}

export const makeWorker = (): CFWorker => {
  return {
    fetch: async (request, env, _ctx) => {
      const url = new URL(request.url)
      const searchParams = url.searchParams
      const storeId = searchParams.get('storeId')

      if (storeId === null) {
        return new Response('storeId search param is required', { status: 400 })
      }

      const id = env.WEBSOCKET_SERVER.idFromName(storeId)
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
