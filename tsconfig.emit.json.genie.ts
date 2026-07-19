import { isTsconfigReferenceTarget } from './repos/effect-utils/packages/@overeng/genie/src/runtime/composition/mod.ts'
import { tsconfigJson } from './genie/repo.ts'
import { rootTsconfigProjects } from './genie/tsconfig-projects.ts'

export default tsconfigJson({
  files: [],
  references: rootTsconfigProjects
    .filter(
      (project) => project.tsconfig !== undefined && isTsconfigReferenceTarget(project.tsconfig.data),
    )
    .map((project) => ({ path: `./${project.path}` }))
    .toSorted((a, b) => a.path.localeCompare(b.path)),
})
