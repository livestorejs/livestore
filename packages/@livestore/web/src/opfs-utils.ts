// NOTE we're already firing off this promise call here since we'll need it anyway and need it cached

import { prettyBytes } from '@livestore/utils'

// To improve LiveStore compatibility with e.g. Node.js we're guarding for `navigator` / `navigator.storage` to be defined.
export const rootHandlePromise =
  typeof navigator === 'undefined' || navigator.storage === undefined
    ? new Promise<never>(() => {})
    : navigator.storage.getDirectory()

export const getDirHandle = async (absDirPath: string | undefined) => {
  const rootHandle = await rootHandlePromise
  if (absDirPath === undefined) return rootHandle

  let dirHandle = rootHandle
  const directoryStack = absDirPath?.split('/').filter(Boolean)
  while (directoryStack.length > 0) {
    dirHandle = await dirHandle.getDirectoryHandle(directoryStack.shift()!)
  }

  return dirHandle
}

export const printTree = async (
  directoryHandle_: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle> = rootHandlePromise,
  depth: number = Number.POSITIVE_INFINITY,
  prefix: string = '',
): Promise<void> => {
  if (depth < 0) return

  const directoryHandle = await directoryHandle_
  const entries = directoryHandle.values()

  for await (const entry of entries) {
    const isDirectory = entry.kind === 'directory'
    const size = entry.kind === 'file' ? await entry.getFile().then((file) => prettyBytes(file.size)) : undefined
    console.log(`${prefix}${isDirectory ? '📁' : '📄'} ${entry.name} ${size ? `(${size})` : ''}`)

    if (isDirectory) {
      const nestedDirectoryHandle = await directoryHandle.getDirectoryHandle(entry.name)
      await printTree(nestedDirectoryHandle, depth - 1, `${prefix}  `)
    }
  }
}

export const deleteAll = async (directoryHandle: FileSystemDirectoryHandle) => {
  if (directoryHandle.kind !== 'directory') return

  for await (const entryName of directoryHandle.keys()) {
    await directoryHandle.removeEntry(entryName, { recursive: true })
  }
}
