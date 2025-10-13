import fs from 'node:fs'
import path from 'node:path'

import { CommandExecutor, Duration, Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { cmd } from './cmd.ts'

const withNode = Vitest.makeWithTestCtx({
  makeLayer: () => PlatformNode.NodeContext.layer,
  timeout: 20_000,
})

Vitest.describe('cmd helper', () => {
  const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

  Vitest.scopedLive('runs tokenized string without shell', (test) =>
    Effect.gen(function* () {
      const exit = yield* cmd('printf ok')
      expect(exit).toBe(CommandExecutor.ExitCode(0))
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('runs array input', (test) =>
    Effect.gen(function* () {
      const exit = yield* cmd(['printf', 'ok'])
      expect(exit).toBe(CommandExecutor.ExitCode(0))
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('supports logging with archive + retention', (test) =>
    Effect.gen(function* () {
      const workspace = process.env.WORKSPACE_ROOT!
      const logsDir = path.join(workspace, 'tmp', 'cmd-tests', String(Date.now()))

      // first run
      const exit1 = yield* cmd('printf first', { logDir: logsDir })
      expect(exit1).toBe(CommandExecutor.ExitCode(0))
      const current = path.join(logsDir, 'dev.log')
      expect(fs.existsSync(current)).toBe(true)
      const firstLog = fs.readFileSync(current, 'utf8')
      const firstStdoutLines = firstLog.split('\n').filter((line) => line.includes('[stdout]'))
      expect(firstStdoutLines.length).toBeGreaterThan(0)
      for (const line of firstStdoutLines) {
        expect(line).toContain('[stdout] first')
        expect(line).toContain('INFO')
        expect(line).toContain('printf first')
      }

      // second run — archives previous
      const exit2 = yield* cmd('printf second', { logDir: logsDir })
      expect(exit2).toBe(CommandExecutor.ExitCode(0))
      const archiveDir = path.join(logsDir, 'archive')
      const archives = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.log'))
      expect(archives.length).toBe(1)
      const archivedPath = path.join(archiveDir, archives[0]!)
      const archivedLog = fs.readFileSync(archivedPath, 'utf8')
      const archivedStdoutLines = archivedLog.split('\n').filter((line) => line.includes('[stdout]'))
      expect(archivedStdoutLines.length).toBeGreaterThan(0)
      for (const line of archivedStdoutLines) {
        expect(line).toContain('[stdout] first')
      }

      const secondLog = fs.readFileSync(current, 'utf8')
      const secondStdoutLines = secondLog.split('\n').filter((line) => line.includes('[stdout]'))
      expect(secondStdoutLines.length).toBeGreaterThan(0)
      for (const line of secondStdoutLines) {
        expect(line).toContain('[stdout] second')
        expect(line).toContain('INFO')
      }

      // generate many archives to exercise retention (keep 50)
      for (let i = 0; i < 60; i++) {
        // Use small unique payloads
        yield* cmd(['printf', String(i)], { logDir: logsDir })
      }
      const archivesAfter = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.log'))
      expect(archivesAfter.length).toBeLessThanOrEqual(50)
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('streams stdout and stderr with logger formatting', (test) =>
    Effect.gen(function* () {
      const workspace = process.env.WORKSPACE_ROOT!
      const logsDir = path.join(workspace, 'tmp', 'cmd-tests', `format-${Date.now()}`)

      const exit = yield* cmd(['node', '-e', "console.log('out'); console.error('err')"], {
        logDir: logsDir,
      })
      expect(exit).toBe(CommandExecutor.ExitCode(0))

      const current = path.join(logsDir, 'dev.log')
      const logContent = fs.readFileSync(current, 'utf8')
      expect(logContent).toMatch(/\[stdout] out/)
      expect(logContent).toMatch(/\[stderr] err/)

      const relevantLines = logContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('[stdout]') || line.includes('[stderr]'))

      expect(relevantLines.length).toBeGreaterThanOrEqual(2)

      for (const line of relevantLines) {
        const stripped = line.replace(ansiRegex, '')
        expect(stripped.startsWith('[')).toBe(true)
        expect(stripped).toMatch(/(INFO|WARN)/)
        expect(stripped).toMatch(/\[(stdout|stderr)]/)
      }
    }).pipe(withNode(test)),
  )

  Vitest.scopedLive('cleans up logged child process when interrupted', (test) =>
    Effect.gen(function* () {
      const workspace = process.env.WORKSPACE_ROOT!
      const logsDir = path.join(workspace, 'tmp', 'cmd-tests', `timeout-${Date.now()}`)

      const result = yield* cmd(['node', '-e', 'setTimeout(() => {}, 5000)'], {
        logDir: logsDir,
        stdout: 'pipe',
        stderr: 'pipe',
      }).pipe(Effect.timeoutOption(Duration.millis(200)))

      expect(result._tag).toBe('None')
      expect(fs.existsSync(path.join(logsDir, 'dev.log'))).toBe(true)
    }).pipe(withNode(test)),
  )
})
