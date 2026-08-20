/**
 * Repo-local paths for the shared PR snapshot pipeline.
 *
 * Only values that genuinely differ per repository live here. The emitted validator paths are
 * identical in every consumer, so they are defaults in the shared factory rather than restated.
 */

export const releaseTopologyPath = 'scripts/src/generated/release-topology.json'
export const prSnapshotAttestationPredicateType = 'https://livestore.dev/attestations/pr-snapshot-candidate/v1'
