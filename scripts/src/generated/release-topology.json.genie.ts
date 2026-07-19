import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import {
  changesetsIgnoredPackageJsonNames,
  externalSnapshotPackageDescriptors,
  publishableLivestorePackageDescriptors,
  publishableLivestorePackageJsonNames,
  snapshotLivestorePackageJsonNames,
} from '../../../genie/release-topology.ts'

export default jsonArtifact({
  data: {
    publishablePackages: publishableLivestorePackageDescriptors,
    publishablePackageNames: publishableLivestorePackageJsonNames,
    externalSnapshotPackages: externalSnapshotPackageDescriptors,
    snapshotPackageNames: snapshotLivestorePackageJsonNames,
    changesetsIgnoredPackageNames: changesetsIgnoredPackageJsonNames,
  },
})
