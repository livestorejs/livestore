import '@testing-library/jest-dom/vitest'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { shouldNeverHappen } from '@livestore/utils'
import { vi } from 'vitest'

// In jsdom the browser build of wa-sqlite tries to fetch the wasm; jsdom cannot
// fetch local files, so we serve the compiled wasm from disk via a fetch shim.
const workspaceRoot = process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
const wasmPath = path.join(workspaceRoot, 'packages', '@livestore', 'wa-sqlite', 'dist', 'wa-sqlite.node.wasm')
const wasmBinary = await readFile(wasmPath)
const originalFetch = globalThis.fetch.bind(globalThis)

const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.includes('wa-sqlite') && input.endsWith('.wasm')) {
    return new Response(wasmBinary, {
      status: 200,
      headers: { 'Content-Type': 'application/wasm' },
    })
  }

  return originalFetch(input, init)
}

/** Shim fetch to serve wa-sqlite wasm from disk in jsdom environment */
globalThis.fetch = Object.assign(customFetch, originalFetch) as typeof globalThis.fetch

// required for svelte5 + jsdom as jsdom does not support matchMedia
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  enumerable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// add more mocks here if you need them
