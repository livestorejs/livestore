import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Console, Effect, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { runPeerDepCheck } from '../shared/peer-deps.ts'

export class LintError extends Schema.TaggedError<LintError>()('LintError', {
  message: Schema.String,
}) {}

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

  const ignoredGeneratedDocPaths = ['docs/src/content/docs/api/']

  const filesWithImports = result
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => ignoredGeneratedDocPaths.every((ignoredPath) => !line.includes(ignoredPath)))

  if (filesWithImports.length > 0) {
    yield* Console.error(
      `Error: Found .md files with import statements. These must be renamed to .mdx:\n${filesWithImports.map((p) => `  - ${p}`).join('\n')}`,
    )
    return yield* new LintError({ message: 'Found .md files with imports' })
  }
}).pipe(Effect.withSpan('checkMdFilesNoImports'))

/**
 * Exclude patterns for oxfmt (genie-generated read-only files).
 * Note: Generated .jsonc files and package.json/tsconfig.json are in .oxfmtrc.json ignorePatterns.
 */
const oxfmtExcludePatterns = ['!.github/workflows/*.yml']

/** Run oxfmt format check (uses .oxfmtrc.json) */
const runFormatCheck = cmd(['oxfmt', '--check', '.', ...oxfmtExcludePatterns]).pipe(
  Effect.provide(LivestoreWorkspace.toCwd()),
  Effect.withSpan('formatCheck'),
)

/** Run oxfmt format fix (uses .oxfmtrc.json) */
const runFormatFix = cmd(['oxfmt', '.', ...oxfmtExcludePatterns]).pipe(
  Effect.provide(LivestoreWorkspace.toCwd()),
  Effect.withSpan('formatFix'),
)

/** Run oxlint check (uses .oxlintrc.json) */
const runLintCheck = cmd(['oxlint', '--import-plugin', '--deny-warnings']).pipe(
  Effect.provide(LivestoreWorkspace.toCwd()),
  Effect.withSpan('lintCheck'),
)

/** Run oxlint fix (uses .oxlintrc.json) */
const runLintFix = cmd(['oxlint', '--import-plugin', '--deny-warnings', '--fix']).pipe(
  Effect.provide(LivestoreWorkspace.toCwd()),
  Effect.withSpan('lintFix'),
)

export const lintCommand = Cli.Command.make(
  'lint',
  { fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)) },
  Effect.fn(function* ({ fix }) {
    // Run oxfmt and oxlint (format + lint)
    if (fix) {
      yield* runFormatFix
      yield* runLintFix
    } else {
      yield* runFormatCheck
      yield* runLintCheck
    }

    // Shell needed for wildcards
    yield* cmd('./scripts/node_modules/.bin/madge --circular --no-spinner examples/*/src packages/*/*/src', {
      shell: true,
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    // Check peer dependencies (warn-only for now, doesn't fail the build)
    const peerDepsOk = yield* runPeerDepCheck
    if (!peerDepsOk) {
      yield* Console.warn('Peer dependency check found violations (see above)')
    }

    // Check that .md files don't contain imports (should be .mdx)
    yield* checkMdFilesNoImports
  }),
)
