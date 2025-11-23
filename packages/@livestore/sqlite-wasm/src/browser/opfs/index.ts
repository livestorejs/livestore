import { Effect, type Scope } from '@livestore/utils/effect'
import type { Opfs } from '@livestore/utils/effect/browser'
import type * as WaSqlite from '@livestore/wa-sqlite'

import { VfsAdapter } from '../../vfs/VfsAdapter.ts'
import { VfsBackend } from '../../vfs/VfsBackend.ts'
import { OpfsPool, type OpfsPoolShape } from './OpfsPool.ts'

// Export the new Effect-based OPFS VFS services
export {
  HEADER_OFFSET_DATA,
  makeOpfsLayer,
  makeOpfsPoolLayer,
  makeOpfsVfsBackendLayer,
  OpfsPool,
  type OpfsPoolConfig,
  type OpfsPoolShape,
} from './OpfsVfs.ts'

// Re-export VfsBackend and VfsAdapter for convenience
export { VfsBackend, type VfsBackendShape } from '../../vfs/VfsBackend.ts'
export { VfsAdapter } from '../../vfs/VfsAdapter.ts'

const semaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)
const vfsAdapterMap = new Map<string, VfsAdapter>()

/**
 * Create an OPFS-backed SQLite database.
 *
 * This function requires VfsBackend and OpfsPool services in the Effect context,
 * which can be provided by `makeOpfsLayer`.
 *
 * @example
 * ```ts
 * import { makeOpfsDb, makeOpfsLayer } from '@livestore/sqlite-wasm/browser/opfs'
 * import { Effect, Layer, ManagedRuntime, Opfs } from '@livestore/utils/effect'
 *
 * const program = Effect.gen(function* () {
 *   const { dbPointer, pool } = yield* makeOpfsDb({
 *     sqlite3,
 *     directory: '/sqlite',
 *     fileName: 'mydb.sqlite3',
 *   })
 *   // Use dbPointer with sqlite3 API
 *   // Use pool for OPFS utilities (e.g., pool.getOpfsFileName())
 * })
 *
 * const layer = makeOpfsLayer({ directoryPath: '/sqlite' }).pipe(
 *   Layer.provide(Opfs.layerOpfsWorker)
 * )
 * const runtime = ManagedRuntime.make(layer)
 * runtime.runPromise(program)
 * ```
 */
export const makeOpfsDb = ({
  sqlite3,
  directory,
  fileName,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  directory: string
  fileName: string
}): Effect.Effect<{ dbPointer: number; pool: OpfsPoolShape }, never, VfsBackend | OpfsPool | Scope.Scope> =>
  Effect.gen(function* () {
    // Replace all special characters with underscores
    const safePath = directory.replaceAll(/["*/:<>?\\|]/g, '_')
    const pathSegment = safePath.length === 0 ? '' : `-${safePath}`
    const vfsName = `opfs${pathSegment}`

    if (sqlite3.vfs_registered.has(vfsName) === false) {
      // Create the VfsAdapter using the VfsBackend from context
      const vfs = yield* VfsAdapter.create(vfsName, (sqlite3 as any).module)
      sqlite3.vfs_register(vfs, false)
      vfsAdapterMap.set(vfsName, vfs)
    }

    const dbPointer = sqlite3.open_v2Sync(fileName, undefined, vfsName)
    const pool = yield* OpfsPool

    return { dbPointer, pool }
  }).pipe(semaphore.withPermits(1))
