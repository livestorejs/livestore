import semver from 'semver'

export const MAIN_BRANCH_NAME = 'main'
export const LEGACY_DEV_BRANCH_NAME = 'dev'

export const DOCS_PROD_SITE = 'livestore-docs'
export const DOCS_DEV_SITE = 'livestore-docs-dev'
export const DOCS_PROD_URL = 'https://docs.livestore.dev'
export const DOCS_DEV_URL = 'https://dev.docs.livestore.dev'

export type DeploymentKind = 'prod' | 'dev' | 'preview'

export const isStableReleaseVersion = (version: string): boolean => {
  const validVersion = semver.valid(version)
  return validVersion !== null && semver.prerelease(validVersion) === null && version.includes('-snapshot-') === false
}

export const assertProductionDeployAllowed = (version: string): void => {
  if (isStableReleaseVersion(version) === false) {
    throw new Error(
      `Production deploys require a stable LiveStore release version. Got ${version}. Use the default dev deploy for snapshots and prereleases.`,
    )
  }
}

export const isPrimaryIntegrationBranch = (branchName: string): boolean => {
  const normalizedBranch = branchName.toLowerCase()
  return normalizedBranch === MAIN_BRANCH_NAME || normalizedBranch === LEGACY_DEV_BRANCH_NAME
}
