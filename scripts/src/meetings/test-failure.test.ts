import { expect, test } from 'vitest'

import { safeFailureCode } from './publication-status.ts'
import { testFailureCode } from './test-failure.ts'

test('test fingerprints change with failing identities, not logs, ordering or checkout location', () => {
  const report = (root: string, names: string[], message: string) => ({
    testResults: [
      {
        name: `${root}/scripts/meeting.test.ts`,
        status: 'failed',
        message,
        assertionResults: names.map((fullName) => ({ fullName, status: 'failed', failureMessages: [message] })),
      },
    ],
  })
  const first = testFailureCode(report('/one', ['a', 'b'], 'secret-token'), '/one')
  expect(first).toBe(testFailureCode(report('/two', ['b', 'a'], 'different-secret'), '/two'))
  expect(first).not.toBe(testFailureCode(report('/one', ['c'], 'secret-token'), '/one'))
  expect(first).toMatch(/^tests:[a-f0-9]{64}$/)
  expect(safeFailureCode(first)).toBe(first)
  expect(testFailureCode({}, '/one')).toBe('tests:runner-failed')
  expect(safeFailureCode('tests:secret-token')).toBeUndefined()
})
