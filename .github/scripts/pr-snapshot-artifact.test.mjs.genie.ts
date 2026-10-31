import { ciWorkflowSupportFiles } from '#mr/effect-utils/genie/ci-workflow.ts'

const shared = ciWorkflowSupportFiles.prSnapshotArtifactTest.output

// Temporary override of effect-utils genie/ci-scripts/pr-snapshot-artifact.test.mjs:391–394.
// Remove with the Effect 4.1.0 migration once it takes the upstream job-scoping fix.
const data = shared.data.replace(
  String.raw`  assert.doesNotMatch(
    ciWorkflow,
    /pack-pr-snapshot:[\s\S]*?head\.repo\.full_name == github\.repository/,
  )`,
  String.raw`  const packSnapshotJob = ciWorkflow.match(/^ {2}pack-pr-snapshot:\n(?:(?!^ {2}[\w-]+:)[\s\S])*/m)
  assert.ok(packSnapshotJob, 'Missing pack-pr-snapshot job')
  assert.doesNotMatch(packSnapshotJob[0], /head\.repo\.full_name == github\.repository/)`,
)

export default { ...shared, data, stringify: () => data }
