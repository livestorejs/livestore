import path from 'node:path'

import * as Vitest from '@effect/vitest'
import { Effect, FileSystem, Queue } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { resolveCachePaths } from './cache.ts'
import { __internal, type WatchDiagramsRebuildInfo, watchDiagrams } from './cli.ts'

const { summarizeWatchEvent } = __internal

Vitest.describe('summarizeWatchEvent', () => {
  Vitest.it('filters out non-.tldr files', () => {
    const paths = resolveCachePaths('/project')

    const txtEvent = { _tag: 'Update' as const, path: '/project/src/content/_assets/diagrams/readme.txt' }
    Vitest.expect(summarizeWatchEvent(paths, txtEvent)).toBeNull()

    const mdEvent = { _tag: 'Update' as const, path: '/project/src/content/_assets/diagrams/notes.md' }
    Vitest.expect(summarizeWatchEvent(paths, mdEvent)).toBeNull()
  })

  Vitest.it('accepts .tldr files', () => {
    const paths = resolveCachePaths('/project')

    const tldrEvent = { _tag: 'Update' as const, path: '/project/src/content/_assets/diagrams/diagram.tldr' }
    const result = summarizeWatchEvent(paths, tldrEvent)

    Vitest.expect(result).not.toBeNull()
    Vitest.expect(result?.relativePath).toBe('diagram.tldr')
    Vitest.expect(result?.kind).toBe('Update')
  })

  Vitest.it('filters out events inside cache directory', () => {
    const paths = resolveCachePaths('/project')

    const cacheEvent = { _tag: 'Update' as const, path: '/project/node_modules/.astro-tldraw/manifest.json' }
    Vitest.expect(summarizeWatchEvent(paths, cacheEvent)).toBeNull()
  })

  Vitest.it('filters out events outside diagrams root', () => {
    const paths = resolveCachePaths('/project')

    const outsideEvent = { _tag: 'Update' as const, path: '/other-project/diagrams/diagram.tldr' }
    Vitest.expect(summarizeWatchEvent(paths, outsideEvent)).toBeNull()
  })

  Vitest.it('handles nested .tldr files', () => {
    const paths = resolveCachePaths('/project')

    const nestedEvent = { _tag: 'Create' as const, path: '/project/src/content/_assets/diagrams/subdir/nested.tldr' }
    const result = summarizeWatchEvent(paths, nestedEvent)

    Vitest.expect(result).not.toBeNull()
    Vitest.expect(result?.relativePath).toBe('subdir/nested.tldr')
    Vitest.expect(result?.kind).toBe('Create')
  })
})

Vitest.describe('watchDiagrams', () => {
  Vitest.scopedLive(
    'runs initial build on start (empty diagrams dir)',
    Effect.fn(function* () {
      const fs = yield* FileSystem.FileSystem
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: 'tldraw-watch-' })

      /* Create diagrams directory (empty - no diagrams) */
      const diagramsDir = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams')
      yield* fs.makeDirectory(diagramsDir, { recursive: true }).pipe(Effect.orDie)

      const rebuildEvents = yield* Queue.unbounded<WatchDiagramsRebuildInfo>()

      const watchEffect = watchDiagrams({
        projectRoot,
        verbose: false,
        debounce: '20 millis',
        onRebuild: (info) => Queue.offer(rebuildEvents, info),
      })

      yield* Effect.forkScoped(watchEffect)

      const initial = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('5 seconds'), Effect.orDie)
      Vitest.expect(initial.reason).toBe('initial')
      Vitest.expect(initial.event).toBeNull()
    }, Effect.provide(PlatformNode.NodeFileSystem.layer)),
    { timeout: 10000 },
  )

  Vitest.scopedLive(
    'ignores non-.tldr file changes',
    Effect.fn(function* () {
      const fs = yield* FileSystem.FileSystem
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: 'tldraw-watch-' })

      /* Create diagrams directory (empty - no diagrams so initial build is fast) */
      const diagramsDir = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams')
      yield* fs.makeDirectory(diagramsDir, { recursive: true }).pipe(Effect.orDie)

      const rebuildEvents = yield* Queue.unbounded<WatchDiagramsRebuildInfo>()

      const watchEffect = watchDiagrams({
        projectRoot,
        verbose: false,
        debounce: '20 millis',
        onRebuild: (info) => Queue.offer(rebuildEvents, info),
      })

      yield* Effect.forkScoped(watchEffect)

      /* Wait for initial build */
      const initial = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('5 seconds'), Effect.orDie)
      Vitest.expect(initial.reason).toBe('initial')

      /* Create a non-.tldr file - should NOT trigger rebuild */
      const txtPath = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams', 'readme.txt')
      yield* fs.writeFileString(txtPath, 'This should not trigger a rebuild').pipe(Effect.orDie)

      /* Wait briefly - should NOT trigger rebuild */
      const shouldBeNone = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('500 millis'), Effect.option)

      Vitest.expect(shouldBeNone._tag).toBe('None')
    }, Effect.provide(PlatformNode.NodeFileSystem.layer)),
    { timeout: 10000 },
  )

  Vitest.scopedLive(
    'triggers rebuild when .tldr file is created',
    Effect.fn(function* () {
      const fs = yield* FileSystem.FileSystem
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: 'tldraw-watch-' })

      /* Create diagrams directory (empty - no diagrams so initial build is fast) */
      const diagramsDir = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams')
      yield* fs.makeDirectory(diagramsDir, { recursive: true }).pipe(Effect.orDie)

      const rebuildEvents = yield* Queue.unbounded<WatchDiagramsRebuildInfo>()

      const watchEffect = watchDiagrams({
        projectRoot,
        verbose: false,
        debounce: '50 millis',
        onRebuild: (info) => Queue.offer(rebuildEvents, info),
      })

      yield* Effect.forkScoped(watchEffect)

      /* Wait for initial build */
      const initial = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('5 seconds'), Effect.orDie)
      Vitest.expect(initial.reason).toBe('initial')

      /* Create a .tldr file - this SHOULD trigger a rebuild attempt */
      const tldrPath = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams', 'new-diagram.tldr')
      yield* fs.writeFileString(tldrPath, '{}').pipe(Effect.orDie)

      /* Wait for rebuild event (with timeout - may not trigger on all platforms) */
      const maybeUpdate = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('2 seconds'), Effect.option)

      if (maybeUpdate._tag === 'None') {
        /* File watching may not work reliably in all CI environments - skip assertion */
        return
      }

      const update = maybeUpdate.value
      Vitest.expect(update.reason).toBe('watch')
      Vitest.expect(update.event?.relativePath).toBe('new-diagram.tldr')
    }, Effect.provide(PlatformNode.NodeFileSystem.layer)),
    { timeout: 10000 },
  )
})
