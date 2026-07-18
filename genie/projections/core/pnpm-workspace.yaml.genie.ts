import { createGenieOutput } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/core.ts'
import { stringify } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/utils/yaml.ts'

import { coreWorkspacePackages } from '../../../package.json.genie.ts'
import { commonPnpmPolicySettings, pnpmWorkspaceYaml } from '../../repo.ts'

const coreWorkspaceRoot = pnpmWorkspaceYaml.root({
  packages: coreWorkspacePackages,
  repoName: 'livestore',
  ...commonPnpmPolicySettings,
})

/**
 * Core package-selection projection for Livestore.
 *
 * This keeps the repository root authoritative while exposing a smaller member
 * selection to downstream consumers. This directory intentionally has no
 * package manifest or lockfile and must not be treated as a Materialization
 * Root.
 */
const coreWorkspaceData = {
  ...coreWorkspaceRoot.data,
  packages: coreWorkspaceRoot.data.packages.map((memberPath) => `../../../${memberPath}`),
}

export default createGenieOutput({
  data: coreWorkspaceData,
  stringify: () => stringify(coreWorkspaceData),
  validate: coreWorkspaceRoot.validate,
})
