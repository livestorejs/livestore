import { Console, Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { hasParentGitRepo } from '../shared/misc.ts'
import { runPeerDepCheck } from '../shared/peer-deps.ts'

/**
 * Checks that no `.md` files contain ESM import statements.
 * Files with imports must use `.mdx` extension for Astro to process them correctly.
 *
 * Ideally Astro would warn about this natively - see upstream issue:
 * https://github.com/withastro/astro/issues/14966
 */
const checkMdFilesNoImports = Effect.gen(function* () {
  // Use grep to find .md files with import statements
  // grep returns exit code 1 when no matches found, which is what we want (success = no files)
  const result = yield* cmdText('grep -rl "^import " docs/src/content/docs --include="*.md" 2>/dev/null || true', {
    runInShell: true,
  }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

  const filesWithImports = result
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)

  if (filesWithImports.length > 0) {
    yield* Console.error(
      `Error: Found .md files with import statements. These must be renamed to .mdx:\n${filesWithImports.map((p) => `  - ${p}`).join('\n')}`,
    )
    return yield* Effect.fail(new Error('Found .md files with imports'))
  }
}).pipe(Effect.withSpan('checkMdFilesNoImports'))

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

    // Check that .md files don't contain imports (should be .mdx)
    yield* checkMdFilesNoImports
  }),
)
