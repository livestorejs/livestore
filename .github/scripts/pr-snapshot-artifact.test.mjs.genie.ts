import { ciWorkflowSupportFiles } from '#mr/effect-utils/genie/ci-workflow.ts'

const shared = ciWorkflowSupportFiles.prSnapshotArtifactTest.output

// Temporary override based on effect-utils 8e18fdddff6e380de7f6983fcd492aff45b156ab.
// The upstream follow-up was requested: inspect only the top-level if and cover trusted runs-on.
// Remove with the Effect 4.1.0 migration once it takes both upstream fixes.
const guardTests = String.raw`const assertPackPrSnapshotGuard = (workflow) => {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line === '  pack-pr-snapshot:')
  assert.notEqual(start, -1, 'pack-pr-snapshot job must exist')
  const remaining = lines.slice(start + 1)
  const end = remaining.findIndex((line) => /^(?: {2}[\w-]+:|[^\s#])/.test(line))
  const job = [lines[start], ...remaining.slice(0, end === -1 ? undefined : end)].join('\n')
  assert.match(job, /pack-pr-snapshot:\n    if: github\.event_name == 'pull_request'/)
  const condition = job.match(/^ {4}if:[^\n]*(?:\n {6}[^\n]*)*/m)
  assert.ok(condition, 'pack-pr-snapshot must have a top-level if')
  assert.doesNotMatch(condition[0], /head\.repo\.full_name == github\.repository/)
}

test('snapshot guard assertion ignores later jobs and stops at the end of the jobs map', () => {
  const snapshotJob = "jobs:\n  pack-pr-snapshot:\n    if: github.event_name == 'pull_request'\n    steps: []\n"
  assert.doesNotThrow(() =>
    assertPackPrSnapshotGuard(snapshotJob + '  later-job:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n'),
  )
  assert.doesNotThrow(() =>
    assertPackPrSnapshotGuard(snapshotJob + 'env:\n  SAME_REPO: head.repo.full_name == github.repository\n'),
  )
  assert.doesNotThrow(() => assertPackPrSnapshotGuard(snapshotJob))
})

test('snapshot guard assertion rejects a same-repo guard in the snapshot job itself', () => {
  assert.throws(
    () =>
      assertPackPrSnapshotGuard("jobs:\n  pack-pr-snapshot:\n    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository\n    steps: []\n"),
    assert.AssertionError,
  )
})

test('snapshot guard assertion allows a same-repo condition in trusted runner configuration', () => {
  assert.doesNotThrow(() =>
    assertPackPrSnapshotGuard("jobs:\n  pack-pr-snapshot:\n    if: github.event_name == 'pull_request'\n    runs-on: [\"namespace-profile-linux-x86-64;github.run-id=\u0024{{ github.run_id }}\u0024{{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && ';container.privileged=true' || '' }};job.priority=3\"]\n    steps: []\n"),
  )
})`

const data = shared.data
  .replace('\ntest(', () => '\n' + guardTests + '\n\ntest(')
  .replace(
    String.raw`  assert.match(ciWorkflow, /pack-pr-snapshot:\n    if: github\.event_name == 'pull_request'/)
  assert.doesNotMatch(
    ciWorkflow,
    /pack-pr-snapshot:[\s\S]*?head\.repo\.full_name == github\.repository/,
  )`,
    '  assertPackPrSnapshotGuard(ciWorkflow)',
  )

export default { ...shared, data, stringify: () => data }
