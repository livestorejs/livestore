import type { Adapter, SyncOptions } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { makeAdapter as makeNodeAdapter, type NodeAdapterOptions } from '@livestore/adapter-node'
import { Effect } from '@livestore/utils/effect'

export type WebSsrAdapterInMemoryStorageOptions = {
  type: 'in-memory'
  importSnapshot?: Uint8Array<ArrayBuffer>
}

export type WebSsrAdapterFsStorageOptions = {
  type: 'fs'
  baseDirectory?: string
}

export type WebSsrAdapterStorageOptions =
  | WebSsrAdapterInMemoryStorageOptions
  | WebSsrAdapterFsStorageOptions

export interface WebSsrAdapterOptions {
  storage?: WebSsrAdapterStorageOptions
  clientId?: string
  sessionId?: string
  sync?: SyncOptions
}

const ensureServerEnvironment = Effect.gen(function* () {
  if (typeof window !== 'undefined') {
    return yield* UnexpectedError.make({
      cause:
        '[@livestore/adapter-web/ssr] makeSsrAdapter is intended for server-only usage. Import the browser adapter for client bundles.',
    })
  }
})

export const makeSsrAdapter = ({
  storage = { type: 'in-memory' } satisfies WebSsrAdapterInMemoryStorageOptions,
  clientId,
  sessionId,
  sync,
}: WebSsrAdapterOptions = {}): Adapter => {
  const nodeStorage: NodeAdapterOptions['storage'] =
    storage.type === 'in-memory'
      ? { type: 'in-memory', importSnapshot: storage.importSnapshot }
      : { type: 'fs', baseDirectory: storage.baseDirectory }

  const nodeAdapter = makeNodeAdapter({
    storage: nodeStorage,
    clientId,
    sessionId,
    sync,
  })

  return (adapterArgs) =>
    Effect.gen(function* () {
      yield* ensureServerEnvironment

      return yield* nodeAdapter(adapterArgs)
    })
}
