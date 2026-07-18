import { createGenieOutput } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/core.ts'
import { stringify } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/utils/yaml.ts'

import { toolingWorkspacePackages } from '../../../package.json.genie.ts'
import { commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPackageExtensions, repoPnpmAllowBuilds } from '../../repo.ts'

const toolingWorkspaceRoot = pnpmWorkspaceYaml.root({
  packages: toolingWorkspacePackages,
  repoName: 'livestore',
  ...commonPnpmPolicySettings,
  allowBuilds: repoPnpmAllowBuilds,
  packageExtensions: repoPackageExtensions,
  /** Relaxed until @livestore/devtools-vite publishes with updated Effect peer ranges */
  strictPeerDependencies: false,
})

/**
 * Tooling package-selection projection for Livestore.
 *
 * This extends the core selection with the local/docs/test packages needed by
 * downstream devtools and release workflows. The repository root remains the
 * sole package manifest and lock authority.
 */
const toolingWorkspaceData = {
  ...toolingWorkspaceRoot.data,
  packages: toolingWorkspaceRoot.data.packages.map((memberPath) => `../../../${memberPath}`),
}

export default createGenieOutput({
  data: toolingWorkspaceData,
  stringify: () => stringify(toolingWorkspaceData),
  validate: toolingWorkspaceRoot.validate,
})
