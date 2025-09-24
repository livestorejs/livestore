import { Effect } from '../index.ts'
import { Opfs } from './index.ts'

export const getDirectoryHandleByPath = Effect.fn('@livestore/utils:Opfs.getDirectoryHandleByPath')(function* (
  path: string,
  options?: FileSystemGetDirectoryOptions,
) {
  const opfs = yield* Opfs
  const rootDirHandle = yield* opfs.getRootDirectoryHandle

  const pathSegments = path.split('/').filter((segment) => segment.length > 0)

  let currentDirHandle = rootDirHandle
  for (const segment of pathSegments) {
    currentDirHandle = yield* opfs.getDirectoryHandle(currentDirHandle, segment, options)
  }

  return currentDirHandle
})

/**
 * Remove a file or directory. By setting the recursive option to true, you can recursively remove nested directories.
 */
export const remove = Effect.fn('@livestore/utils:Opfs.remove')(function* (
  path: string,
  options?: { readonly recursive?: boolean },
) {
  const recursive = options?.recursive ?? false

  const opfs = yield* Opfs
  const rootDirHandle = yield* opfs.getRootDirectoryHandle

  const pathSegments = path.split('/').filter((segment) => segment.length > 0)
  const targetName = pathSegments.pop()

  let parentDirHandle = rootDirHandle
  for (const segment of pathSegments) {
    parentDirHandle = yield* opfs.getDirectoryHandle(parentDirHandle, segment)
  }

  // TODO: Fail with an error if targetName is undefined or properly parse the path to handle such cases.
  yield* opfs.removeEntry(parentDirHandle, targetName ?? '', { recursive: recursive })
})

export const exists = Effect.fn('@livestore/utils:Opfs.exists')(function* (
  parent: FileSystemDirectoryHandle,
  name: string,
) {
  const opfs = yield* Opfs

  return yield* opfs.getFileHandle(parent, name).pipe(
    Effect.orElse(() => opfs.getDirectoryHandle(parent, name, { create: false })),
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
  const pathSegments = path.split('/').filter((segment) => segment.length > 0)

  const opfs = yield* Opfs
  const rootDirHandle = yield* opfs.getRootDirectoryHandle

  let currentDirHandle = rootDirHandle
  yield* Effect.forEach(pathSegments, (segment, index) =>
    Effect.gen(function* () {
      const isLastSegment = index === pathSegments.length - 1
      const shouldCreate = recursive || isLastSegment

      currentDirHandle = yield* opfs.getDirectoryHandle(
        currentDirHandle,
        segment,
        shouldCreate ? { create: true } : undefined,
      )
    }),
  )
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
  const pathSegments = path.split('/').filter((segment) => segment.length > 0)
  const fileName = pathSegments.pop()

  const opfs = yield* Opfs

  return yield* Effect.scoped(
    Effect.gen(function* () {
      let parentDirHandle = yield* opfs.getRootDirectoryHandle
      for (const segment of pathSegments) {
        parentDirHandle = yield* opfs.getDirectoryHandle(parentDirHandle, segment)
      }

      // TODO: Fail with an error if fileName is undefined or properly parse the path to handle such cases.
      const fileHandle = yield* opfs.getFileHandle(parentDirHandle, fileName ?? '', { create: true })

      yield* opfs.writeFile(fileHandle, new Uint8Array(data), {
        keepExistingData: false,
      })
    }),
  )
})
