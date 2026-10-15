import { createHash } from 'node:crypto'
import { relative } from 'node:path'

export const testFailureCode = (report: unknown, root: string): string => {
  if (
    typeof report !== 'object' ||
    report === null ||
    !('testResults' in report) ||
    Array.isArray(report.testResults) === false
  )
    return 'tests:runner-failed'
  const names: string[] = []
  for (const suite of report.testResults) {
    if (typeof suite !== 'object' || suite === null || suite.status !== 'failed' || typeof suite.name !== 'string')
      continue
    const file = relative(root, suite.name)
    const assertions: unknown[] = Array.isArray(suite.assertionResults) === true ? suite.assertionResults : []
    const failed = assertions.flatMap((test) =>
      typeof test === 'object' &&
      test !== null &&
      'status' in test &&
      test.status === 'failed' &&
      'fullName' in test &&
      typeof test.fullName === 'string'
        ? [test.fullName]
        : [],
    )
    if (failed.length === 0) names.push(file)
    else names.push(...failed.map((name) => `${file}:${name}`))
  }
  // Hash identities only. Error messages, output, stack traces and secrets never leave this process.
  return names.length === 0
    ? 'tests:runner-failed'
    : `tests:${createHash('sha256').update(JSON.stringify(names.sort())).digest('hex')}`
}
