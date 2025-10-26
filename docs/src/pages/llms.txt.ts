import type { APIRoute } from 'astro'
import { loadLlmsDocs, renderLlmsText } from '../utils/llms.ts'

export const GET: APIRoute = async ({ site }) => {
  const docs = await loadLlmsDocs()
  return new Response(renderLlmsText({ docs, site: site ?? null }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
