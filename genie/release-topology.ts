import { rootWorkspacePackages } from '../package.json.genie.ts'

const isLivestorePackageName = (name: string | undefined): name is `@livestore/${string}` =>
  name?.startsWith('@livestore/') === true

const publishableLivestorePackages = rootWorkspacePackages
  .filter((pkg) => isLivestorePackageName(pkg.data.name) && pkg.data.private !== true)
  .map((pkg) => ({
    name: pkg.data.name,
    dir: pkg.meta.workspace.memberPath,
  }))
  .toSorted((a, b) => a.name.localeCompare(b.name))

const ignoredLivestorePackages = rootWorkspacePackages
  .filter((pkg) => isLivestorePackageName(pkg.data.name) && pkg.data.private === true)
  .map((pkg) => pkg.data.name)
  .toSorted()

export const publishableLivestorePackageDescriptors = publishableLivestorePackages
export const publishableLivestorePackageJsonNames = publishableLivestorePackages.map((pkg) => pkg.name)
export const changesetsIgnoredPackageJsonNames = ignoredLivestorePackages
