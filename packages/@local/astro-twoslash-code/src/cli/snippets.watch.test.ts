import path from 'node:path'

import { Effect, FileSystem, Queue } from '@livestore/utils/effect'
import { NodeRecursiveWatchLayer } from '@livestore/utils/node'
import { describe, expect, it } from 'vitest'

import { type WatchSnippetsRebuildInfo, watchSnippets } from './snippets.ts'

const createDocsImportSource = (relativeSnippetPath: string) => `---
title: Snippet Watch Test
---

import code from "${relativeSnippetPath}?snippet"

\`\`\`twoslash
${'${'}code${'}'}
\`\`\`
`

const writeInitialProject = (fs: FileSystem.FileSystem, projectRoot: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const snippetDir = path.join(projectRoot, 'src', 'content', '_assets', 'code')
    const docsDir = path.join(projectRoot, 'src', 'pages')

    yield* fs.makeDirectory(snippetDir, { recursive: true }).pipe(Effect.orDie)
    yield* fs.makeDirectory(docsDir, { recursive: true }).pipe(Effect.orDie)

    const snippetPath = path.join(snippetDir, 'example.ts')
    const docsPath = path.join(docsDir, 'guide.mdx')
    const tsconfigPath = path.join(snippetDir, 'tsconfig.json')

    yield* fs.writeFileString(snippetPath, 'export const value = 1\n').pipe(Effect.orDie)
    yield* fs.writeFileString(docsPath, createDocsImportSource('../content/_assets/code/example.ts')).pipe(Effect.orDie)
    yield* fs
      .writeFileString(
        tsconfigPath,
        `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ESNext',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              types: ['node'],
              skipLibCheck: true,
              allowImportingTsExtensions: true,
              noEmit: true,
            },
            include: ['./**/*'],
            exclude: ['./node_modules'],
          },
          null,
          2,
        )}\n`,
      )
      .pipe(Effect.orDie)
  })

describe('watchSnippets', () => {
  it('rebuilds when snippet assets change', async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: 'twoslash-watch-' })
        yield* writeInitialProject(fs, projectRoot).pipe(Effect.orDie)

        const rebuildEvents = yield* Queue.unbounded<WatchSnippetsRebuildInfo>()

        const watchEffect = watchSnippets({
          projectRoot,
          debounce: '20 millis',
          onRebuild: (info) => Queue.offer(rebuildEvents, info),
        })

        yield* Effect.forkScoped(watchEffect)

        const initial = yield* Queue.take(rebuildEvents)
        expect(initial.reason).toBe('initial')

        const snippetPath = path.join(projectRoot, 'src', 'content', '_assets', 'code', 'example.ts')
        yield* fs.writeFileString(snippetPath, 'export const value = 2\n').pipe(Effect.orDie)

        const maybeUpdate = yield* Queue.take(rebuildEvents).pipe(Effect.timeout('2 seconds'), Effect.option)

        if (maybeUpdate._tag === 'None') {
          return
        }

        const update = maybeUpdate.value
        expect(update.reason).toBe('watch')
        expect(update.event?.relativePath).toContain('example.ts')
        expect(update.renderedCount).toBeGreaterThanOrEqual(0)
      }),
    )

    await Effect.runPromise(program.pipe(Effect.provide(NodeRecursiveWatchLayer)))
  }, 10000)
})
