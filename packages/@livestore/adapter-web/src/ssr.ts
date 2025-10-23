import { makeAdapter as makeNodeAdapter } from '@livestore/adapter-node'
import type { SyncOptions } from '@livestore/common'
import { liveStoreVersion, type MigrationsReport } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStorePromise } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import type { Schema } from '@livestore/utils/effect'

const DEFAULT_INITIAL_SYNC_TIMEOUT = 5_000

export interface WebAdapterSsrSnapshot {
  storeId: string
  snapshot: Uint8Array<ArrayBuffer>
  migrationsReport: MigrationsReport
  liveStoreVersion: string
}

export interface WebAdapterSsrEncodedSnapshot {
  storeId: string
  snapshotBase64: string
  migrationsReport: MigrationsReport
  liveStoreVersion: string
}

export interface CreateWebAdapterSsrSnapshotOptions {
  schema: LiveStoreSchema
  storeId?: string
  sync?: SyncOptions
  syncPayload?: Schema.JsonValue
  storage?: Parameters<typeof makeNodeAdapter>[0]['storage']
}

export const createWebAdapterSsrSnapshot = async ({
  schema,
  storeId = 'default',
  sync,
  syncPayload,
  storage,
}: CreateWebAdapterSsrSnapshotOptions): Promise<WebAdapterSsrSnapshot> => {
  const adapter = makeNodeAdapter({
    storage: storage ?? { type: 'in-memory' },
    ...omitUndefineds({
      sync:
        sync ??
        ({
          initialSyncOptions: { _tag: 'Blocking' as const, timeout: DEFAULT_INITIAL_SYNC_TIMEOUT },
        } satisfies SyncOptions),
    }),
  })

  const store = await createStorePromise({
    schema,
    storeId,
    adapter,
    disableDevtools: true,
    batchUpdates: (run) => run(),
    syncPayload,
  })

  try {
    return {
      storeId,
      snapshot: store.sqliteDbWrapper.export(),
      migrationsReport: store.clientSession.leaderThread.initialState.migrationsReport,
      liveStoreVersion,
    }
  } finally {
    await store.shutdownPromise().catch(() => {})
  }
}

export const encodeWebAdapterSsrSnapshot = (snapshot: WebAdapterSsrSnapshot): WebAdapterSsrEncodedSnapshot => ({
  storeId: snapshot.storeId,
  snapshotBase64: encodeBase64(snapshot.snapshot),
  migrationsReport: snapshot.migrationsReport,
  liveStoreVersion: snapshot.liveStoreVersion,
})

export const decodeWebAdapterSsrSnapshot = (encoded: WebAdapterSsrEncodedSnapshot): WebAdapterSsrSnapshot => ({
  storeId: encoded.storeId,
  snapshot: decodeBase64(encoded.snapshotBase64),
  migrationsReport: encoded.migrationsReport,
  liveStoreVersion: encoded.liveStoreVersion,
})

const encodeBase64 = (bytes: Uint8Array<ArrayBuffer>): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  if (typeof globalThis.btoa === 'function') {
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }

    return globalThis.btoa(binary)
  }

  throw new Error('Base64 encoding is not supported in this environment')
}

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }

  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value)

    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return bytes
  }

  throw new Error('Base64 decoding is not supported in this environment')
}
