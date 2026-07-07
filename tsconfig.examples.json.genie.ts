import { tsconfigJson } from './genie/repo.ts'

/**
 * Root tsconfig for example builds.
 * References all example projects for composite builds.
 */
export default tsconfigJson({
  compilerOptions: {},
  include: [],
  references: [
    { path: './examples/cloudflare-todomvc' },
    { path: './examples/tutorial-starter' },
    { path: './examples/web-email-client' },
    { path: './examples/web-linearlite' },
    { path: './examples/web-todomvc-script' },
    { path: './examples/web-todomvc' },
    { path: './examples/web-todomvc-sync-cf' },
  ],
})
