import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { Effect, Exit } from '@livestore/utils/effect'

import { assertTestsExecuted } from './test-commands.ts'

const suiteFile = 'sync-provider.test.ts'

/** Builds a Vitest JSON report from `{ fileName: [statuses] }`. */
const writeReport = (files: Record<string, readonly string[]>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livestore-test-report-'))
  const reportPath = path.join(dir, 'report.json')
  const testResults = Object.entries(files).map(([name, statuses]) => ({
    name: `/repo/tests/sync-provider/src/${name}`,
    assertionResults: statuses.map((status) => ({ status })),
  }))
  fs.writeFileSync(reportPath, JSON.stringify({ testResults }))
  return reportPath
}

const run = (files: Record<string, readonly string[]>) =>
  Effect.runPromiseExit(assertTestsExecuted({ reportPath: writeReport(files), suiteFile }))

describe('assertTestsExecuted', () => {
  it('accepts a run that executed the conformance suite', async () => {
    expect(Exit.isSuccess(await run({ [suiteFile]: ['passed', 'passed'] }))).toBe(true)
  })

  it('counts failures as executed, so a quarantined run still satisfies the guard', async () => {
    expect(Exit.isSuccess(await run({ [suiteFile]: ['failed', 'failed'] }))).toBe(true)
  })

  it('rejects a run where the conformance suite was entirely skipped', async () => {
    expect(Exit.isSuccess(await run({ [suiteFile]: ['skipped', 'skipped'] }))).toBe(false)
  })

  it('rejects a skipped conformance suite even when utility suites passed', async () => {
    // `registry.test.ts` runs in every provider cell; counting the run's total would let its
    // passes mask a conformance suite that never ran.
    const exit = await run({ [suiteFile]: ['skipped'], 'registry.test.ts': ['passed', 'passed', 'passed'] })

    expect(Exit.isSuccess(exit)).toBe(false)
  })

  it('rejects a run missing the conformance suite entirely', async () => {
    expect(Exit.isSuccess(await run({ 'registry.test.ts': ['passed'] }))).toBe(false)
  })
})
