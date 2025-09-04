import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'
import { hasParentGitRepo } from '../shared/misc.ts'

const cwd =
  process.env.WORKSPACE_ROOT ??
  (() => {
    throw new Error(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
  })()

export const lintCommand = Cli.Command.make(
  'lint',
  { fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)) },
  Effect.fn(function* ({ fix }) {
    const fixFlag = fix ? '--fix --unsafe' : ''
    yield* cmd(`biome check scripts tests packages docs examples --error-on-warnings ${fixFlag}`, { shell: true })
    if (fix) {
      yield* cmd('syncpack fix-mismatches', { cwd })
      yield* cmd('syncpack format', { cwd })

      if ((yield* hasParentGitRepo) === false) {
        yield* cmd('pnpm install --fix-lockfile', { cwd })
      }
    }

    yield* cmd('syncpack lint', { cwd })

    // Shell needed for wildcards
    yield* cmd('madge --circular --no-spinner examples/*/src packages/*/*/src', { cwd, shell: true })
  }),
)
