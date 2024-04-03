/* eslint-disable unicorn/prefer-add-event-listener */

import { Effect, Schema } from '@livestore/utils/effect'

export class IdbBinaryError extends Schema.TaggedError<IdbBinaryError>()('IDBError', {
  error: Schema.any,
}) {}

/**
 * Small Effect wrapper around IndexedDB for storing binary data.
 */
export class IdbBinary {
  private db: IDBDatabase | null = null

  constructor(
    private dbName: string,
    private storeName: string,
  ) {}

  private open = Effect.async<IDBDatabase, IdbBinaryError>((cb) => {
    if (this.db) return cb(Effect.succeed(this.db))

    const openRequest = indexedDB.open(this.dbName, 1)

    openRequest.onupgradeneeded = () => {
      const db = openRequest.result
      if (!db.objectStoreNames.contains(this.storeName)) {
        db.createObjectStore(this.storeName)
      }
    }

    openRequest.onsuccess = () => {
      this.db = openRequest.result
      cb(Effect.succeed(this.db))
    }

    openRequest.onerror = () => {
      cb(new IdbBinaryError({ error: 'Failed to open database.' }))
    }
  })

  public get = (key: string) =>
    Effect.flatMap(this.open, (db) =>
      Effect.async<Uint8Array | undefined, IdbBinaryError>((cb) => {
        const transaction = db.transaction(this.storeName, 'readonly')
        const store = transaction.objectStore(this.storeName)
        const getRequest = store.get(key)

        getRequest.onsuccess = () => {
          cb(Effect.succeed(getRequest.result))
        }

        getRequest.onerror = () => {
          cb(new IdbBinaryError({ error: 'Failed to get data.' }))
        }
      }),
    )

  public put = (key: string, value: Uint8Array) =>
    Effect.flatMap(this.open, (db) =>
      Effect.async<void, IdbBinaryError>((cb) => {
        const transaction = db.transaction(this.storeName, 'readwrite')
        const store = transaction.objectStore(this.storeName)
        const putRequest = store.put(value, key)

        putRequest.onsuccess = () => {
          cb(Effect.succeed(void 0))
        }

        putRequest.onerror = () => {
          cb(new IdbBinaryError({ error: 'Failed to write data.' }))
        }
      }),
    )

  public close = Effect.try({
    try: () => {
      if (this.db) {
        this.db.close()
        this.db = null
      }
    },
    catch: (error) => new IdbBinaryError({ error }),
  })

  public deleteDb = Effect.async<void, IdbBinaryError>((cb) => {
    const deleteRequest = indexedDB.deleteDatabase(this.dbName)

    deleteRequest.onsuccess = () => {
      cb(Effect.unit)
    }

    deleteRequest.onerror = () => {
      cb(new IdbBinaryError({ error: 'Failed to delete database.' }))
    }
  })
}
