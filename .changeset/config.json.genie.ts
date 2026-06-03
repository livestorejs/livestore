import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import { changesetsIgnoredPackageJsonNames, publishableLivestorePackageJsonNames } from '../genie/release-topology.ts'

export default jsonArtifact({
  data: {
    $schema: 'https://unpkg.com/@changesets/config@3.1.1/schema.json',
    changelog: false,
    commit: false,
    fixed: [publishableLivestorePackageJsonNames],
    linked: [],
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    ignore: changesetsIgnoredPackageJsonNames,
  },
})
