import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import {
  changesetsIgnoredPackageJsonNames,
  publishableLivestorePackageDescriptors,
  publishableLivestorePackageJsonNames,
} from '../../../genie/repo-topology.ts'

export default jsonArtifact({
  data: {
    publishablePackages: publishableLivestorePackageDescriptors,
    publishablePackageNames: publishableLivestorePackageJsonNames,
    changesetsIgnoredPackageNames: changesetsIgnoredPackageJsonNames,
  },
})
