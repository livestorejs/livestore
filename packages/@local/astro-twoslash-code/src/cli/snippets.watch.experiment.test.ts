import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { Effect, FileSystem, Layer, Stream } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { layer as ParcelWatcherLayer } from '@effect/platform-node-shared/NodeFileSystem/ParcelWatcher'

describe('Parcel watcher integration experiment', () => {
  it('captures create/update/delete inside nested directories', async () => {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectory({ prefix: 'parcel-watch-experiment-' })
      const nestedDir = path.join(root, 'alpha', 'beta')
      const target = path.join(nestedDir, 'snippet.ts')

      yield* fs.makeDirectory(nestedDir, { recursive: true })

      const watchStream = fs.watch(root)
      const collector = watchStream.pipe(
        Stream.filter((event) => event.path.endsWith('snippet.ts')),
        Stream.take(3),
        Stream.runCollect,
      )

      const fiber = yield* Effect.fork(collector)

      yield* fs.writeFileString(target, 'export const value = 1\n')
      yield* fs.writeFileString(target, 'export const value = 2\n')
      yield* fs.remove(target)

      const events = yield* Effect.join(fiber)
      return events.toReadonlyArray().map((event) => event._tag)
    }).pipe(Effect.withSpan('parcel-watch-experiment'))

    const runtimeLayer = Layer.mergeAll(
      PlatformNode.NodeFileSystem.layer,
      ParcelWatcherLayer,
    )

    const result = await PlatformNode.NodeRuntime.runMain(
      program.pipe(Effect.provideLayer(runtimeLayer)),
    )

    expect(result).toEqual(['Create', 'Update', 'Remove'])
  })
})
