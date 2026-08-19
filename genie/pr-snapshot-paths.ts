/**
 * Repo-local paths threaded into the shared PR snapshot job factory.
 *
 * Kept in one place because each is referenced from both workflows: a divergence between the pack
 * job's `--topology` and the validator's would not fail loudly, it would validate the wrong cohort.
 */

export const releaseTopologyPath = 'scripts/src/generated/release-topology.json'
export const prSnapshotValidatorPath = '.github/scripts/pr-snapshot-artifact.mjs'
export const prSnapshotValidatorTestPath = '.github/scripts/pr-snapshot-artifact.test.mjs'
export const prSnapshotAttestationPredicateType = 'https://livestore.dev/attestations/pr-snapshot-candidate/v1'
