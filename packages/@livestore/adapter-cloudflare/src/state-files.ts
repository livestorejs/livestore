import type { CfTypes } from '@livestore/common-cf'
import { Effect } from '@livestore/utils/effect'

/** Record ownership before opening state so interrupted rebuilds remain eligible for cleanup. */
export const register = (storage: CfTypes.DurableObjectStorage, fileName: string) =>
  Effect.try(() => {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS __livestore_state_files (file_path TEXT PRIMARY KEY) WITHOUT ROWID`)
    storage.sql.exec('INSERT OR IGNORE INTO __livestore_state_files (file_path) VALUES (?)', `/${fileName}`)
  })

/** Keep ownership records until their pages are deleted, so failed cleanup can be retried. */
export const cleanup = (storage: CfTypes.DurableObjectStorage, fileName: string) =>
  Effect.try(() =>
    storage.transactionSync(() => {
      storage.sql.exec(
        `DELETE FROM vfs_pages WHERE file_path IN (
          SELECT file_path FROM __livestore_state_files WHERE file_path != ?
        )`,
        `/${fileName}`,
      )
      storage.sql.exec('DELETE FROM __livestore_state_files WHERE file_path != ?', `/${fileName}`)
    }),
  )
