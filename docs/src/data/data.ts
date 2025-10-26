import { execSync } from 'node:child_process'

import { liveStoreVersion } from '@livestore/common'
import { isNonEmptyString } from '@livestore/utils'

export const officeHours = [
  'https://www.youtube.com/embed/X2Ia7vc-190', // 4
  'https://www.youtube.com/embed/_VDSqi3k-gE', // 3
  'https://www.youtube.com/embed/MenhU6n0r5c', // 2
  'https://www.youtube.com/embed/2GYKgI1GU8k', // 1
]

export const getBranchName = () =>
  isNonEmptyString(process.env.GITHUB_BRANCH_NAME)
    ? process.env.GITHUB_BRANCH_NAME
    : execSync('git rev-parse --abbrev-ref HEAD').toString().trim()

export const versionNpmSuffix = liveStoreVersion.includes('dev') ? `@${liveStoreVersion}` : ''

export const npmTagSuffix = liveStoreVersion.includes('dev') ? '@dev' : ''

export const IS_MAIN_BRANCH = getBranchName() === 'main'

export const makeTiged = (example: string, approach: 'bunx' | 'pnpm dlx' | 'npx') => {
  const hashSuffix = `#${getBranchName()}`
  // The quotes around the github URI are necessary for certain shells (e.g. zsh) to parse correctly
  return `${approach} tiged "github:livestorejs/livestore/examples/${example}${hashSuffix}" livestore-app`
}

export const makeCreate = (example: string, approach: 'bunx' | 'pnpm dlx' | 'npx' | 'yarn dlx') => {
  const branch = getBranchName()
  const branchFlag = branch !== 'dev' ? ` --branch ${branch}` : ''
  const packageName = `@livestore/cli${npmTagSuffix}`
  return `${approach} ${packageName} create --example ${example}${branchFlag} livestore-app`
}
