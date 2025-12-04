export default {
  async fetch(_request: Request) {
    return new Response('Not Found', { status: 404 })
  },
}
