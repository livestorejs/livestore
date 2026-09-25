import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { clearFailure, recordFailure } from '@local/shared/contributor-meeting-failure'

test('job output tracks the latest phase and clears after success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meeting-failure-'))
  const previous = process.env.GITHUB_OUTPUT
  const output = join(directory, 'output')
  process.env.GITHUB_OUTPUT = output
  try {
    await recordFailure('page')
    await recordFailure('feed', new DOMException('secret-value', 'TimeoutError'))
    expect(await readFile(output, 'utf8')).toBe('failure=page:failed\nfailure=feed:timeout\n')
    await clearFailure()
    expect((await readFile(output, 'utf8')).trimEnd().split('\n').at(-1)).toBe('failure=')
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT
    else process.env.GITHUB_OUTPUT = previous
    await rm(directory, { recursive: true })
  }
})
