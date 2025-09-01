export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response('Hello from Wrangler Dev Server test worker!')
  },
}

export class TestDO {
  async fetch(_request: Request): Promise<Response> {
    return new Response('Hello from Test Durable Object!')
  }
}