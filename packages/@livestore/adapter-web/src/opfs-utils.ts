// This file exists for backwards compatibility since they're part of this package's exports and is also exposed in
// `__debugLiveStoreUtils`.
//
// New code should use the OPFS utilities available in `@livestore/utils/effect` directly.

import { prettyBytes } from '@livestore/utils'
import { Effect, Opfs } from '@livestore/utils/effect'

const OPFS_UNSUPPORTED_ERROR = new Error(
  `Can't get OPFS root handle in this environment as navigator.storage is undefined`,
)

// To improve LiveStore compatibility with e.g. Node.js we're guarding for `navigator` / `navigator.storage` to be defined.
const hasOpfsSupport = typeof navigator !== 'undefined' && navigator.storage !== undefined

const runOpfsEffect = <A>(effect: Effect.Effect<A, unknown, Opfs.Opfs>) =>
  hasOpfsSupport
    ? effect.pipe(Effect.provide(Opfs.Opfs.Default), Effect.runPromise)
    : Promise.reject(OPFS_UNSUPPORTED_ERROR)

// NOTE we're already firing off this promise call here since we'll need it anyway and need it cached
export const rootHandlePromise = hasOpfsSupport
  ? runOpfsEffect(Opfs.Opfs.getRootDirectoryHandle)
  : // We're using a proxy here to make the promise reject lazy
    (new Proxy(
      {},
      {
        get: () => Promise.reject(OPFS_UNSUPPORTED_ERROR),
      },
    ) as never)

export const getDirHandle = (absDirPath: string | undefined, options: { create?: boolean } = {}) => {
  if (absDirPath === undefined) return rootHandlePromise
  return runOpfsEffect(Opfs.getDirectoryHandleByPath(absDirPath, options))
}

const printTreeEffect = (
  directoryHandle: FileSystemDirectoryHandle,
  depth: number,
  prefix: string,
): Effect.Effect<void, unknown, Opfs.Opfs> =>
  Effect.gen(function* () {
    if (depth < 0) return

    const entries = yield* Opfs.Opfs.listEntries(directoryHandle)

    for (const entry of entries) {
      const isDirectory = entry.kind === 'directory'
      let sizeString: string | undefined

      if (entry.kind === 'file') {
        const fileHandle = entry.handle
        const file = yield* Opfs.Opfs.getFile(fileHandle)
        sizeString = prettyBytes(file.size)
      }

      yield* Effect.log(`${prefix}${isDirectory ? '📁' : '📄'} ${entry.name} ${sizeString ? `(${sizeString})` : ''}`)

      if (!isDirectory) continue

      yield* printTreeEffect(entry.handle, depth - 1, `${prefix}  `)
    }
  })

export const printTree = async (
  directoryHandle_: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle> = rootHandlePromise,
  depth: number = Number.POSITIVE_INFINITY,
  prefix = '',
): Promise<void> => {
  if (depth < 0) return

  const directoryHandle = await directoryHandle_
  await runOpfsEffect(printTreeEffect(directoryHandle, depth, prefix))
}

export const deleteAll = (directoryHandle: FileSystemDirectoryHandle) =>
  runOpfsEffect(
    Effect.gen(function* () {
      const entries = yield* Opfs.Opfs.listEntries(directoryHandle)

      for (const entry of entries) {
        yield* Opfs.Opfs.removeEntry(directoryHandle, entry.name, { recursive: true })
      }
    }),
  )
