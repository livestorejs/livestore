import { tsconfigJson } from './genie/repo.ts'
import { rootTsconfigProjects } from './genie/tsconfig-projects.ts'

/**
 * Root TypeScript check graph.
 * References every project covered by the repository-level TypeScript check.
 */
export default tsconfigJson({
  files: [],
  references: rootTsconfigProjects
    .map((project) => ({ path: `./${project.path}` }))
    .toSorted((a, b) => a.path.localeCompare(b.path)),
})
