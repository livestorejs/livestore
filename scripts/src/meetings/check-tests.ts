import { spawnSync } from 'node:child_process'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testFailureCode } from './test-failure.ts'

const directory = await mkdtemp(join(tmpdir(), 'meeting-test-results-'))
const reportPath = join(directory, 'results.json')
let failure = 'tests:runner-failed'
try {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'scripts/vitest.config.ts',
      'src/meetings',
      '--reporter=default',
      '--reporter=json',
      '--outputFile',
      reportPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.status === 0) failure = ''
  else {
    try {
      failure = testFailureCode(JSON.parse(await readFile(reportPath, 'utf8')), process.cwd())
    } catch {
      /* No parseable report: retain the bounded runner-failure code. */
    }
    process.exitCode = 1
  }
} finally {
  if (process.env.GITHUB_OUTPUT !== undefined) await appendFile(process.env.GITHUB_OUTPUT, `failure=${failure}\n`)
  await rm(directory, { recursive: true })
}
