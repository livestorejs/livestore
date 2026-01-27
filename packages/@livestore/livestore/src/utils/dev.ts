import type { SqliteDb } from '@livestore/common'
import { prettyBytes, shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

declare global {
  var __debugLiveStoreUtils: any
}

// TODO refactor: Move downloadBlob/downloadURL to browser-specific module or expose via adapter
// These are browser-only utilities that shouldn't require DOM type declarations in isomorphic code.

/** Browser globals - only available in browser environments */
declare const window: { URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void } } | undefined
declare const document: { createElement(tag: string): any; body: { append(el: any): void } } | undefined

/** Download a blob as a file. Browser-only. */
export const downloadBlob = (
  data: Uint8Array<ArrayBuffer> | Blob | string,
  fileName: string,
  mimeType = 'application/octet-stream',
) => {
  if (typeof window === 'undefined') return shouldNeverHappen('downloadBlob is only available in browser environments')

  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })

  const url = window.URL.createObjectURL(blob)

  downloadURL(url, fileName)

  setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

/** Download a URL as a file. Browser-only. */
export const downloadURL = (data: string, fileName: string) => {
  if (typeof document === 'undefined') return shouldNeverHappen('downloadURL is only available in browser environments')

  const a = document.createElement('a')
  a.href = data
  a.download = fileName
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
