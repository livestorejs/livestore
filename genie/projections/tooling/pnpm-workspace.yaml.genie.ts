import { toolingWorkspacePackages } from '../../../package.json.genie.ts'
import { createGenieOutput } from '../../../repos/effect-utils/packages/@overeng/genie/src/runtime/core.ts'
import { stringify } from '../../../repos/effect-utils/packages/@overeng/genie/src/runtime/utils/yaml.ts'
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
 * Tooling install projection for Livestore.
 *
 * This extends the core install root with the local/docs/test packages needed by
 * downstream devtools and release workflows while still avoiding the full repo
 * workspace breadth.
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
