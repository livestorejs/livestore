import { Effect } from '../index.ts'
import { Opfs, OpfsError } from './Opfs.ts'

/**
 * Set of path segments that are forbidden by the File System specification.
 *
 * A valid segment is non-empty, not equal to `.` or `..`, and must not have path separator characters.
 *
 * @see {@link https://fs.spec.whatwg.org/#valid-file-name | File System Spec}
 */
const DISALLOWED_SEGMENTS = new Set(['.', '..'])

/**
 * Parse a slash-separated OPFS path into validated segments.
 *
 * Rejects empty paths and disallows `.` / `..` so callers cannot rely on implicit current/parent
 * directory semantics that the File System Access API does not support.
 *
 * @param path - Slash-delimited path relative to the OPFS root.
 * @returns Effect that yields the sanitized path segments.
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
 * Resolve a directory path from the OPFS root and return the final directory handle.
 *
 * @param segments - Ordered list of directory names to follow.
 * @param options - Options forwarded to each `getDirectoryHandle` call.
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
 * Ensure that a directory path exists, creating intermediate segments when permitted.
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

/**
 * Resolve a directory handle using a slash-delimited OPFS path.
 *
 * @param path - Directory path relative to the OPFS root.
 * @param options - Options forwarded to `getDirectoryHandle` when traversing segments.
 * @returns Directory handle for the final segment.
 */
export const getDirectoryHandleByPath = Effect.fn('@livestore/utils:Opfs.getDirectoryHandleByPath')(function* (
  path: string,
  options?: FileSystemGetDirectoryOptions,
) {
  const pathSegments = yield* parsePathSegments(path)
  return yield* traverseDirectoryPath(pathSegments, options)
})

/**
 * Remove a file or directory identified by an OPFS path.
 *
 * @param path - Slash-delimited path to delete.
 * @param options.recursive - When `true`, recursively delete directory contents; defaults to `false`.
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
 * Determine whether a file or directory exists at the given OPFS path.
 *
 * @param path - Slash-delimited path to inspect.
 * @returns `true` if the path resolves to a file or directory, otherwise `false`.
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
 * Create a directory at the provided path, optionally creating parents recursively.
 *
 * @param path - Slash-delimited directory path.
 * @param options.recursive - When `true`, create all missing parent segments; defaults to `false`.
 */
export const makeDirectory = Effect.fn('@livestore/utils:Opfs.makeDirectory')(function* (
  path: string,
  options?: { readonly recursive?: boolean },
) {
  const recursive = options?.recursive ?? false
  const pathSegments = yield* parsePathSegments(path)

  yield* ensureDirectoryPath(pathSegments, { recursive })
})

/**
 * Extract basic metadata for a given file handle.
 *
 * @param handle - File handle whose metadata should be read.
 * @returns Object containing name, size, MIME type, and last modification timestamp.
 */
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

/**
 * Write bytes to an OPFS path, creating or replacing the target file.
 *
 * @param path - Slash-delimited file path.
 * @param data - Bytes to persist.
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

/**
 * Metadata exposed directly on OPFS handles so we avoid `getFile()` reads.
 */
interface OpfsEntryMetadata {
  readonly name: string
  readonly path: string
  readonly kind: FileSystemHandleKind
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
  const opfs = yield* Opfs
  const rootHandle = yield* opfs.getRootDirectoryHandle

  const collectDirectory: (
    handle: FileSystemDirectoryHandle,
    pathSegments: ReadonlyArray<string>,
  ) => Effect.Effect<OpfsTreeNode, unknown, never> = (handle, pathSegments) =>
    Effect.gen(function* () {
      const entries = yield* opfs.listEntries(handle)
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

        children.push({
          metadata: {
            name: entry.name,
            path,
            kind: entry.kind,
          },
        })
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

const formatLabel = ({ name, kind }: OpfsEntryMetadata) => `${name}${kind === 'directory' ? ' [dir]' : ` [${kind}]`}`

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

    yield* Effect.log(`${branch}${label}`)

    if (node.children === undefined || node.children.length === 0) return

    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!
      const isLastChild = index === node.children.length - 1
      yield* logAsciiNode(child, { prefix: nextPrefix, isLast: isLastChild })
    }
  })

const logFlatTree: (node: OpfsTreeNode) => Effect.Effect<void, never, never> = (node) =>
  Effect.gen(function* () {
    yield* Effect.log(`${node.metadata.path} [${node.metadata.kind}]`)

    if (node.children === undefined || node.children.length === 0) return

    for (const child of node.children) {
      yield* logFlatTree(child)
    }
  })

const logJsonTree: (node: OpfsTreeNode) => Effect.Effect<void, never, never> = (node) =>
  Effect.log(JSON.stringify(node, null, 2))

export const logOpfsTreeAscii = Effect.fn('@livestore/utils:Opfs.logOpfsTreeAscii')(function* () {
  const tree = yield* buildTree()
  yield* logAsciiTree(tree)
})

export const logOpfsTreeFlatPaths = Effect.fn('@livestore/utils:Opfs.logOpfsTreeFlatPaths')(function* () {
  const tree = yield* buildTree()
  yield* logFlatTree(tree)
})

export const logOpfsTreeJson = Effect.fn('@livestore/utils:Opfs.logOpfsTreeJson')(function* () {
  const tree = yield* buildTree()
  yield* logJsonTree(tree)
})
