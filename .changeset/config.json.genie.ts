import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import { changesetsIgnoredPackageJsonNames, releaseGroupPackageJsonNames } from '../genie/repo-topology.ts'

export default jsonArtifact({
  data: {
    $schema: 'https://unpkg.com/@changesets/config@3.1.1/schema.json',
    changelog: false,
    commit: false,
    fixed: [releaseGroupPackageJsonNames('livestore-fixed')],
    linked: [],
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    ignore: changesetsIgnoredPackageJsonNames,
  },
})
