interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface WorkerEnv {
  ASSETS: AssetsBinding
}

export default {
  async fetch(request: Request, env: WorkerEnv) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
      return assetResponse
    }

    return new Response('Not Found', { status: 404 })
  },
}
