import { Predicate, Schema } from '@livestore/utils/effect'
import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

/**
 * Unique identifier for VFS errors.
 */
export const TypeId = '@livestore/sqlite-wasm/VfsError'

/**
 * Type-level representation of the VFS error identifier.
 */
export type TypeId = typeof TypeId

/**
 * Error codes for VFS operations.
 * Each code maps to a specific SQLite error code.
 */
export type VfsErrorCode =
  | 'FileNotFound'
  | 'CannotOpen'
  | 'Read'
  | 'ShortRead'
  | 'Write'
  | 'Truncate'
  | 'Sync'
  | 'FileSize'
  | 'Delete'
  | 'Access'
  | 'Close'
  | 'Unknown'

/**
 * Maps VFS error codes to SQLite result codes.
 */
const sqliteCodeMap: Record<VfsErrorCode, number> = {
  FileNotFound: VFS.SQLITE_NOTFOUND,
  CannotOpen: VFS.SQLITE_CANTOPEN,
  Read: VFS.SQLITE_IOERR_READ,
  ShortRead: VFS.SQLITE_IOERR_SHORT_READ,
  Write: VFS.SQLITE_IOERR_WRITE,
  Truncate: VFS.SQLITE_IOERR_TRUNCATE,
  Sync: VFS.SQLITE_IOERR_FSYNC,
  FileSize: VFS.SQLITE_IOERR_FSTAT,
  Delete: VFS.SQLITE_IOERR_DELETE,
  Access: VFS.SQLITE_IOERR_ACCESS,
  Close: VFS.SQLITE_IOERR_CLOSE,
  Unknown: VFS.SQLITE_IOERR,
}

/**
 * Single typed error for all VFS operations.
 *
 * Uses a `code` discriminant to identify the type of error.
 * Each code maps to a specific SQLite error code via `sqliteCode`.
 *
 * @example
 * ```ts
 * import { VfsError } from '@livestore/sqlite-wasm/vfs'
 * import { Effect } from 'effect'
 *
 * const readFile = Effect.fail(new VfsError({
 *   code: 'Read',
 *   path: '/data/db.sqlite',
 *   message: 'Failed to read file',
 * }))
 * ```
 */
export class VfsError extends Schema.TaggedError<VfsError>()('@livestore/sqlite-wasm/VfsError', {
  code: Schema.Literal(
    'FileNotFound',
    'CannotOpen',
    'Read',
    'ShortRead',
    'Write',
    'Truncate',
    'Sync',
    'FileSize',
    'Delete',
    'Access',
    'Close',
    'Unknown',
  ),
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  readonly [TypeId]: TypeId = TypeId

  /**
   * Get the SQLite error code corresponding to this VFS error.
   */
  get sqliteCode(): number {
    return sqliteCodeMap[this.code]
  }
}

/**
 * Type guard to check if a value is a VFS error.
 */
export const isVfsError = (u: unknown): u is VfsError => Predicate.hasProperty(u, TypeId)

/**
 * Convert any error to a VfsError.
 * If the error is already a VfsError, returns it as-is.
 * Otherwise wraps it in an Unknown VfsError.
 */
export const toVfsError = (error: unknown, path: string, code: VfsErrorCode = 'Unknown'): VfsError => {
  if (isVfsError(error)) return error

  const message = error instanceof Error ? error.message : 'Unknown error'
  return new VfsError({ code, path, message, cause: error })
}
