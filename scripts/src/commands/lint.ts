import { Console, Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { hasParentGitRepo } from '../shared/misc.ts'
import { runPeerDepCheck } from '../shared/peer-deps.ts'

export const lintCommand = Cli.Command.make(
  'lint',
  { fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)) },
  Effect.fn(function* ({ fix }) {
    const fixFlag = fix ? '--fix --unsafe' : ''
    yield* cmd(`biome check scripts tests packages docs examples --error-on-warnings ${fixFlag}`, {
      shell: true,
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
    if (fix) {
      yield* cmd('syncpack fix-mismatches').pipe(Effect.provide(LivestoreWorkspace.toCwd()))
      yield* cmd('syncpack format').pipe(Effect.provide(LivestoreWorkspace.toCwd()))

      if ((yield* hasParentGitRepo) === false) {
        yield* cmd('pnpm install --fix-lockfile').pipe(Effect.provide(LivestoreWorkspace.toCwd()))
      }
    }

    yield* cmd('syncpack lint').pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    // Shell needed for wildcards
    yield* cmd('madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
    )

    // Check peer dependencies (warn-only for now, doesn't fail the build)
    const peerDepsOk = yield* runPeerDepCheck
    if (!peerDepsOk) {
      yield* Console.warn('Peer dependency check found violations (see above)')
    }
  }),
)
