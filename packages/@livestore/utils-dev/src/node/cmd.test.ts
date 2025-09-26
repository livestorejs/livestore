import fs from 'node:fs'
import path from 'node:path'

import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { cmd } from './cmd.ts'

const withNode = Vitest.makeWithTestCtx({
  makeLayer: () => PlatformNode.NodeContext.layer,
  timeout: 20_000,
})

Vitest.describe('cmd helper', () => {
  Vitest.scopedLive('runs tokenized string without shell', (test) =>
    Effect.gen(function* () {
      const exit = yield* cmd('printf ok')
      expect(Number(exit)).toBe(0)
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('runs array input', (test) =>
    Effect.gen(function* () {
      const exit = yield* cmd(['printf', 'ok'])
      expect(Number(exit)).toBe(0)
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('supports logging with archive + retention', (test) =>
    Effect.gen(function* () {
      const workspace = process.env.WORKSPACE_ROOT!
      const logsDir = path.join(workspace, 'tmp', 'cmd-tests', String(Date.now()))

      // first run
      const exit1 = yield* cmd('printf first', { logDir: logsDir })
      expect(Number(exit1)).toBe(0)
      const current = path.join(logsDir, 'dev.log')
      expect(fs.existsSync(current)).toBe(true)
      expect(fs.readFileSync(current, 'utf8')).toBe('first')

      // second run — archives previous
      const exit2 = yield* cmd('printf second', { logDir: logsDir })
      expect(Number(exit2)).toBe(0)
      const archiveDir = path.join(logsDir, 'archive')
      const archives = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.log'))
      expect(archives.length).toBe(1)
      const archivedPath = path.join(archiveDir, archives[0]!)
      expect(fs.readFileSync(archivedPath, 'utf8')).toBe('first')
      expect(fs.readFileSync(current, 'utf8')).toBe('second')

      // generate many archives to exercise retention (keep 50)
      for (let i = 0; i < 60; i++) {
        // Use small unique payloads
        yield* cmd(['printf', String(i)], { logDir: logsDir })
      }
      const archivesAfter = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.log'))
      expect(archivesAfter.length).toBeLessThanOrEqual(50)
    }).pipe(withNode(test)),
  )
})
