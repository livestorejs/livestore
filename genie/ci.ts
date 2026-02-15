/**
 * Shared CI check names used by both workflow and repository rulesets.
 *
 * This keeps required status checks aligned with matrix expansions.
 */

export const syncProviderMatrix = [
  'mock',
  'electric',
  's2',
  'cf-http-d1',
  'cf-http-do',
  'cf-ws-d1',
  'cf-ws-do',
  'cf-do-rpc-d1',
  'cf-do-rpc-do',
] as const

export const playwrightSuites = ['misc', 'todomvc', 'devtools'] as const

export const requiredCIJobs = [
  'lint',
  'type-check',
  'test-unit',
  'test-integration-node-sync',
  ...syncProviderMatrix.map((provider) => `test-integration-sync-provider (${provider})`),
  ...playwrightSuites.map((suite) => `test-integration-playwright (${suite})`),
  'wa-sqlite-test',
] as const
