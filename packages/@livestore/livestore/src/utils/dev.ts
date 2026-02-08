import type { SqliteDb } from '@livestore/common'
import { prettyBytes } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

declare global {
  var __debugLiveStoreUtils: any
}

export const downloadBlob = (
  data: Uint8Array<ArrayBuffer> | Blob | string,
  fileName: string,
  mimeType = 'application/octet-stream',
) => {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })

  // @ts-ignore TODO(oep-8tc) TS2304: 'window' not available without DOM lib in composite build
  const url = window.URL.createObjectURL(blob)

  downloadURL(url, fileName)

  // @ts-ignore TODO(oep-8tc) TS2304: 'window' not available without DOM lib in composite build
  setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

export const downloadURL = (data: string, fileName: string) => {
  // @ts-ignore TODO(oep-8tc) TS2584: 'document' not available without DOM lib in composite build
  const a = document.createElement('a')
  a.href = data
  a.download = fileName
  // @ts-ignore TODO(oep-8tc) TS2584: 'document' not available without DOM lib in composite build
  document.body.append(a)
  a.style.display = 'none'
  a.click()
  a.remove()
}

export const exposeDebugUtils = () => {
  globalThis.__debugLiveStoreUtils = {
    downloadBlob,
    runSync: (effect: Effect.Effect<any, any, never>) => Effect.runSync(effect),
    runFork: (effect: Effect.Effect<any, any, never>) => Effect.runFork(effect),
    dumpDb: (db: SqliteDb) => {
      const tables = db.select<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)
      for (const table of tables) {
        const rows = db.select<any>(`SELECT * FROM ${table.name}`)
        console.log(`Table: ${table.name} (${prettyBytes(table.name.length)}, ${rows.length} rows)`)
        console.table(rows)
      }
    },
  }
}
