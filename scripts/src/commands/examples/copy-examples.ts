import { cmd, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
/**
 * Since there are many todomvc examples which we want to keep in sync, we're treating the `web-todomvc`
 * example as the source of truth and copy most files from there to the other todomvc examples.
 */
export const copyTodomvcSrc = Cli.Command.make(
  'copy-todomvc-src',
  {},
  Effect.fn(function* () {
    const workspaceRoot = yield* LivestoreWorkspace
    const SRC_EXAMPLE_DIR = `${workspaceRoot}/examples/web-todomvc`
    const targetExamples = ['web-todomvc-custom-elements', 'web-todomvc-experimental', 'web-todomvc-sync-cf']

    for (const example of targetExamples) {
      const targetExampleDir = `${workspaceRoot}/examples/${example}`

      const copy = (subPath: string) =>
        cmd(['rsync', '-av', `${SRC_EXAMPLE_DIR}/src/${subPath}`, `${targetExampleDir}/src/${subPath}`]).pipe(
          Effect.provide(LivestoreWorkspace.toCwd()),
        )

      yield* copy('livestore/')

      if (['web-todomvc-experimental', 'web-todomvc-custom-elements'].includes(example) === true) {
        yield* copy('livestore.worker.ts')
      }

      if (['web-todomvc-sync-cf'].includes(example) === true) {
        yield* copy('components/')
      }
    }
  }),
)
