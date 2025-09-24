import { Effect } from '../index.ts'
import { Opfs, OpfsError } from './Opfs.ts'

// A valid segment is a string that is not an empty string, is not equal to "." or "..",
// and does not contain '/' or any other character used as path separator on the underlying platform.
// See https://fs.spec.whatwg.org/#valid-file-name
const DISALLOWED_SEGMENTS = new Set(['.', '..'])

/**
 * Parse a path string into validated OPFS segments.
 *
 * Rejects empty paths and disallows `.` / `..` segments so callers cannot rely on implicit
 * current/parent-directory semantics (which the File System Access API does not support).
 */
const parsePathSegments = (path: string) =>
  Effect.gen(function* () {
    const segments = path.split('/').filter((segment) => segment.length > 0)

    if (segments.length === 0) {
      return yield* new OpfsError({
        message: `Invalid OPFS path '${path}': path must contain at least one non-empty segment`,
      })
    }

    for (const segment of segments) {
      if (DISALLOWED_SEGMENTS.has(segment)) {
        return yield* new OpfsError({
          message: `Invalid OPFS path '${path}': segment '${segment}' is not supported`,
        })
      }
    }

    return segments
  })

/**
 * Traverse a list of segments starting from the OPFS root directory.
 *
 * @param segments - Ordered list of directory names to follow.
 * @param options - Optional options forwarded to each `getDirectoryHandle` call.
 */
const traverseDirectoryPath = (segments: ReadonlyArray<string>, options?: FileSystemGetDirectoryOptions) =>
  Effect.gen(function* () {
    const opfs = yield* Opfs
    let currentDirHandle = yield* opfs.getRootDirectoryHandle

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!
      currentDirHandle = yield* opfs.getDirectoryHandle(currentDirHandle, segment, options)
    }

    return currentDirHandle
  })

/**
 * Ensure that a directory path exists, creating missing segments when allowed.
 *
 * @param segments - Ordered list of directory names to ensure.
 * @param options.recursive - When `true`, create every missing segment. Otherwise only the leaf is created.
 */
const ensureDirectoryPath = (segments: ReadonlyArray<string>, options: { readonly recursive: boolean }) =>
  Effect.gen(function* () {
    const opfs = yield* Opfs
    let currentDirHandle = yield* opfs.getRootDirectoryHandle

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!
      const isLast = index === segments.length - 1
      const shouldCreate = options.recursive || isLast

      currentDirHandle = yield* opfs.getDirectoryHandle(
        currentDirHandle,
        segment,
        shouldCreate ? { create: true } : undefined,
      )
    }

    return currentDirHandle
  })

export const getDirectoryHandleByPath = Effect.fn('@livestore/utils:Opfs.getDirectoryHandleByPath')(function* (
  path: string,
  options?: FileSystemGetDirectoryOptions,
) {
  const pathSegments = yield* parsePathSegments(path)
  return yield* traverseDirectoryPath(pathSegments, options)
})

/**
 * Remove a file or directory. By setting the recursive option to true, you can recursively remove nested directories.
 */
export const remove = Effect.fn('@livestore/utils:Opfs.remove')(function* (
  path: string,
  options?: { readonly recursive?: boolean },
) {
  const recursive = options?.recursive ?? false
  const pathSegments = yield* parsePathSegments(path)
  const targetName = pathSegments[pathSegments.length - 1]!
  const parentSegments = pathSegments.slice(0, -1)

  const opfs = yield* Opfs
  const parentDirHandle = yield* traverseDirectoryPath(parentSegments)

  yield* opfs.removeEntry(parentDirHandle, targetName, { recursive })
})

/**
 * Check if a `path` exists.
 */
export const exists = Effect.fn('@livestore/utils:Opfs.exists')(function* (path: string) {
  const pathSegments = yield* parsePathSegments(path)
  const targetName = pathSegments[pathSegments.length - 1]!
  const parentSegments = pathSegments.slice(0, -1)

  const opfs = yield* Opfs
  const parentDirHandle = yield* traverseDirectoryPath(parentSegments, { create: false }).pipe(
    Effect.catchTag('@livestore/utils/Browser/NotFoundError', () => Effect.succeed(undefined)),
  )

  if (parentDirHandle === undefined) return false

  return yield* opfs.getFileHandle(parentDirHandle, targetName).pipe(
    Effect.orElse(() => opfs.getDirectoryHandle(parentDirHandle, targetName, { create: false })),
    Effect.as(true),
    Effect.catchTag('@livestore/utils/Browser/NotFoundError', () => Effect.succeed(false)),
  )
})

/**
 * Create a directory at `path`. You can optionally specify whether to recursively create nested directories.
 */
export const makeDirectory = Effect.fn('@livestore/utils:Opfs.makeDirectory')(function* (
  path: string,
  options?: { readonly recursive?: boolean },
) {
  const recursive = options?.recursive ?? false
  const pathSegments = yield* parsePathSegments(path)

  yield* ensureDirectoryPath(pathSegments, { recursive })
})

export const getMetadata = Effect.fn('@livestore/utils:Opfs.getMetadata')(function* (handle: FileSystemFileHandle) {
  const opfs = yield* Opfs

  return yield* opfs.getFile(handle).pipe(
    Effect.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
  )
})

export const copyFile = Effect.fn('@livestore/utils:Opfs.copyFile')(function* (
  source: FileSystemFileHandle,
  destDir: FileSystemDirectoryHandle,
  destName: string,
) {
  const opfs = yield* Opfs

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* opfs.getFile(source)
      const destHandle = yield* opfs.getFileHandle(destDir, destName, { create: true })
      yield* opfs.writeFile(destHandle, file)
      return destHandle
    }),
  )
})

export const moveFile = Effect.fn('@livestore/utils:Opfs.moveFile')(function* (
  sourceFile: FileSystemFileHandle,
  sourceDir: FileSystemDirectoryHandle,
  destDir: FileSystemDirectoryHandle,
  destName: string,
) {
  const opfs = yield* Opfs

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const destHandle = yield* copyFile(sourceFile, destDir, destName)
      yield* opfs.removeEntry(sourceDir, sourceFile.name)
      return destHandle
    }),
  )
})

/**
 * Write data to a file at `path`, replacing the file if it already exists.
 */
export const writeFile = Effect.fn('@livestore/utils:Opfs.writeFile')(function* (path: string, data: Uint8Array) {
  const pathSegments = yield* parsePathSegments(path)
  const fileName = pathSegments[pathSegments.length - 1]!
  const parentSegments = pathSegments.slice(0, -1)

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const opfs = yield* Opfs
      const parentDirHandle = yield* traverseDirectoryPath(parentSegments)
      const fileHandle = yield* opfs.getFileHandle(parentDirHandle, fileName, { create: true })

      yield* opfs.writeFile(fileHandle, new Uint8Array(data), {
        keepExistingData: false,
      })
    }),
  )
})
