import { tsconfigJson } from './genie/repo.ts'

/**
 * Root tsconfig for example builds.
 * References all example projects for composite builds.
 */
export default tsconfigJson({
  compilerOptions: {},
  include: [],
  references: [
    { path: './examples/web-linearlite' },
    { path: './examples/web-todomvc' },
    { path: './examples/web-todomvc-redwood' },
    { path: './examples/web-todomvc-sync-cf' },
  ],
})
