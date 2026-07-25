import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { Effect, Exit } from '@livestore/utils/effect'

import { assertTestsExecuted } from './test-commands.ts'

const writeReport = (report: Record<string, unknown>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livestore-test-report-'))
  const reportPath = path.join(dir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report))
  return reportPath
}

describe('assertTestsExecuted', () => {
  it('fails a run that executed no tests', async () => {
    // The shape Vitest emits when every test is filtered or skipped: `success: true`, zero passed.
    const reportPath = writeReport({ numTotalTests: 116, numPassedTests: 0, numPendingTests: 116, success: true })

    const exit = await Effect.runPromiseExit(assertTestsExecuted(reportPath))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('accepts a run that executed at least one test', async () => {
    const reportPath = writeReport({ numTotalTests: 20, numPassedTests: 16, numPendingTests: 4, success: true })

    const exit = await Effect.runPromiseExit(assertTestsExecuted(reportPath))

    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
