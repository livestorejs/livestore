import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'
/**
 * Since there are many todomvc examples which we want to keep in sync, we're treating the `web-todomvc`
 * example as the source of truth and copy most files from there to the other todomvc examples.
 */
export const copyTodomvcSrc = Cli.Command.make(
  'copy-todomvc-src',
  {},
  Effect.fn(function* () {
    const SRC_EXAMPLE_DIR = `${process.env.WORKSPACE_ROOT}/examples/src/web-todomvc`
    const targetExamples = [
      // 'node-todomvc-sync-cf', // Not included as it doesn't have `uiState`
      'web-todomvc-custom-elements',
      'web-todomvc-experimental',
      'web-todomvc-solid',
      'web-todomvc-sync-cf',
      'web-todomvc-sync-electric',
    ]

    for (const example of targetExamples) {
      const targetExampleDir = `${process.env.WORKSPACE_ROOT}/examples/src/${example}`

      const copy = (subPath: string) =>
        cmd(['rsync', '-av', `${SRC_EXAMPLE_DIR}/src/${subPath}`, `${targetExampleDir}/src/${subPath}`], {
          cwd: process.env.WORKSPACE_ROOT,
        })

      yield* copy('livestore/')

      if (['web-todomvc-solid', 'web-todomvc-experimental', 'web-todomvc-custom-elements'].includes(example)) {
        yield* copy('livestore.worker.ts')
      }

      if (['web-todomvc-sync-cf', 'web-todomvc-sync-electric'].includes(example)) {
        yield* copy('components/')
      }
    }
  }),
)
