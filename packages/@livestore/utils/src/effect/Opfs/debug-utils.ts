/**
 * Debug utilities for OPFS (Origin Private File System) inspection and manipulation.
 * These functions are designed for use in browser devtools console to help debug
 * and inspect the OPFS structure during development.
 */

import { Effect } from 'effect'
import { prettyBytes } from '../../mod.ts'
import { Opfs } from './Opfs.ts'
import { getDirectoryHandleByPath, getMetadata, remove } from './utils.ts'

/**
 * Metadata exposed directly on OPFS handles so we avoid `getFile()` reads.
 */
interface OpfsEntryMetadata {
  readonly name: string
  readonly path: string
  readonly kind: FileSystemHandleKind
  readonly size?: number
  readonly lastModified?: number
}

interface OpfsTreeNode {
  readonly metadata: OpfsEntryMetadata
  readonly children?: ReadonlyArray<OpfsTreeNode>
}

const ROOT_NAME = '/'

/**
 * Materialize the entire OPFS tree starting from the origin root.
 */
const buildTree = Effect.fn('@livestore/utils:Opfs.buildTree')(function* () {
  const rootHandle = yield* Opfs.getRootDirectoryHandle

  const collectDirectory: (
    handle: FileSystemDirectoryHandle,
    pathSegments: ReadonlyArray<string>,
  ) => Effect.Effect<OpfsTreeNode, unknown, Opfs> = (handle, pathSegments) =>
    Effect.gen(function* () {
      const entries = yield* Opfs.listEntries(handle)
      const sorted = entries.slice().sort((left, right) => left.name.localeCompare(right.name))

      const children: OpfsTreeNode[] = []

      for (const entry of sorted) {
        const nextSegments = [...pathSegments, entry.name]
        const path = formatPath(nextSegments)

        if (entry.kind === 'directory') {
          const childDirectory = yield* collectDirectory(entry.handle, nextSegments)
          children.push(childDirectory)
          continue
        }

        if (entry.kind === 'file') {
          const fileMetadata = yield* getMetadata(entry.handle)
          children.push({
            metadata: {
              name: entry.name,
              path,
              kind: entry.kind,
              size: fileMetadata.size,
              lastModified: fileMetadata.lastModified,
            },
          })
        }
      }

      return {
        metadata: {
          name: pathSegments.length === 0 ? ROOT_NAME : pathSegments[pathSegments.length - 1]!,
          path: formatPath(pathSegments),
          kind: 'directory',
        },
        children,
      }
    })

  return yield* collectDirectory(rootHandle, [])
})

const formatPath = (segments: ReadonlyArray<string>) => (segments.length === 0 ? ROOT_NAME : `/${segments.join('/')}`)

const formatLabel = ({ name, kind, size, lastModified }: OpfsEntryMetadata) => {
  let label = name

  if (kind === 'file' && lastModified !== undefined) {
    const date = new Date(lastModified)
    label += ` │ ${date.toISOString().split('T')[0]} ${date.toTimeString().split(' ')[0]}`

    if (size !== undefined) {
      label += ` │ ${prettyBytes(size)}`
    }
  }

  return label
}

const logAsciiTree = (node: OpfsTreeNode): Effect.Effect<void, never, never> =>
  logAsciiNode(node, { prefix: '', isLast: true, isRoot: true })

const logAsciiNode: (
  node: OpfsTreeNode,
  options: { readonly prefix: string; readonly isLast: boolean; readonly isRoot?: boolean },
) => Effect.Effect<void, never, never> = (node, options) =>
  Effect.gen(function* () {
    const label = formatLabel(node.metadata)
    const branch = options.isRoot ? '' : `${options.prefix}${options.isLast ? '└── ' : '├── '}`
    const nextPrefix = options.isRoot ? '' : `${options.prefix}${options.isLast ? '    ' : '│   '}`

    console.log(`${branch}${label}`)

    if (node.children === undefined || node.children.length === 0) return

    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!
      const isLastChild = index === node.children.length - 1
      yield* logAsciiNode(child, { prefix: nextPrefix, isLast: isLastChild })
    }
  })

const printTree = Effect.gen(function* () {
  const tree = yield* buildTree()
  yield* logAsciiTree(tree)
})

const resetTree = remove('/')

const getDirHandle = (path: string, options?: FileSystemGetDirectoryOptions) => getDirectoryHandleByPath(path, options)

const runOpfsEffect = <A, E>(effect: Effect.Effect<A, E, Opfs>) =>
  effect.pipe(Effect.provide(Opfs.Default), Effect.runPromise)

export const debugUtils = {
  /**
   * Print the entire OPFS tree structure to the console in an ASCII format.
   */
  printTree: (): Promise<void> => runOpfsEffect(printTree),
  /**
   * Reset the entire OPFS tree by removing all files and directories.
   */
  resetTree: (): Promise<void> => runOpfsEffect(resetTree),
  /**
   * Get a directory handle for a given path, useful for inspecting or manipulating specific directories.
   */
  getDirHandle: (path: string, options?: FileSystemGetDirectoryOptions) => runOpfsEffect(getDirHandle(path, options)),
} as const
