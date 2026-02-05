import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { shouldNeverHappen } from '@livestore/utils'

// In jsdom the browser build of wa-sqlite tries to fetch the wasm; jsdom cannot
// fetch local files, so we serve the compiled wasm from disk via a fetch shim.
const workspaceRoot = process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
const wasmPath = path.join(workspaceRoot, 'packages', '@livestore', 'wa-sqlite', 'dist', 'wa-sqlite.node.wasm')
const wasmBinary = await readFile(wasmPath)
const originalFetch = globalThis.fetch.bind(globalThis)

globalThis.fetch = async (input, init) => {
  if (typeof input === 'string' && input.includes('wa-sqlite') && input.endsWith('.wasm')) {
    return new Response(wasmBinary, {
      status: 200,
      headers: { 'Content-Type': 'application/wasm' },
    })
  }

  return originalFetch(input, init)
}
