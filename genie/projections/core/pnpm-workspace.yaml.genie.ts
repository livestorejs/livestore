import { coreWorkspacePackages } from '../../../package.json.genie.ts'
import { createGenieOutput } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/core.ts'
import { stringify } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/utils/yaml.ts'
import { commonPnpmPolicySettings, pnpmWorkspaceYaml } from '../../repo.ts'

const coreWorkspaceRoot = pnpmWorkspaceYaml.root({
  packages: coreWorkspacePackages,
  repoName: 'livestore',
  ...commonPnpmPolicySettings,
})

/**
 * Core install projection for Livestore.
 *
 * This keeps the full repo workspace authoritative while exposing a smaller
 * install root for downstream consumers and CI tasks that do not need examples,
 * docs, tests, scripts, or local demos.
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
