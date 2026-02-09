import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { CurrentWorkingDirectory, cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
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
 * Knip configuration for detecting unused files, dependencies, and exports.
 * https://knip.dev
 *
 * Library export handling:
 * Knip automatically detects entry files from package.json (main, exports, bin) and excludes
 * their exports from "unused export" detection. This is correct for a library - public API
 * exports are meant for external consumers, not internal use. To audit which public APIs
 * aren't used internally (e.g., deprecation candidates), run: `knip --include-entry-exports`
 *
 * Uses `ignoreIssues` for targeted suppressions instead of disabling rules globally:
 * - constants.ts: Intentionally exports multiple constants with the same value for semantic clarity
 * - pnpm-workspace.yaml: Catalog entries appear unused because examples/tests/docs workspaces are excluded
 */
const knipConfig = {
  workspaces: {
    '.': {
      ignore: ['patches/**', 'scripts/**'],
    },
    scripts: {
      entry: ['bin/*', 'src/mono.ts', 'standalone/setup.ts'],
    },
    'packages/@livestore/*': {
      entry: ['src/**/*.ts', '!src/**/*.test.ts'],
      ignore: ['dist/**', '**/*.test.ts'],
    },
    'packages/@local/*': {
      entry: ['src/**/*.ts', '!src/**/*.test.ts'],
      ignore: ['dist/**', '**/*.test.ts', '**/test-fixtures/**'],
    },
    'packages/@livestore/wa-sqlite': {
      ignore: ['**'],
    },
    'packages/@livestore/peer-deps': {
      ignore: ['**'],
    },
  },
  ignoreWorkspaces: [
    'docs',
    'docs/src/content/_assets/code',
    'packages/@local/astro-twoslash-code/example',
    'examples/*',
    'tests/*',
  ],
  ignore: [
    '**/dist/**',
    '**/node_modules/**',
    '**/*.d.ts',
    '**/*.worker.ts',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/__tests__/**',
    '**/*.bundle.ts',
    '**/leader-thread-lazy.ts',
  ],
  ignoreDependencies: [
    // Types-only packages (no runtime imports)
    'cloudflare',
    '@cloudflare/workers-types',
    '@types/chrome',
    '@types/wicg-file-system-access',
    '@types/web',
    // Dev/build tools (used by scripts, not source code)
    'wrangler',
    '@effect/vitest',
    '@astrojs/starlight',
    'jsdom',
    'vitest',
    'vite',
    'madge',
    '@livestore/utils-dev',
    // Test dependencies (used in test files which are ignored by knip)
    '@solidjs/testing-library',
    '@testing-library/react',
    '@testing-library/dom',
    '@types/react-dom',
    'react-dom',
    'react-window',
    '@livestore/adapter-web',
    // Re-exported or used transitively
    '@effect/typeclass',
    '@effect/workflow',
    '@opentelemetry/sdk-trace-base',
    // Meta package for peer deps (not directly imported)
    '@livestore/peer-deps',
    // Optional peer dep, dynamically imported in adapter-node
    '@livestore/devtools-vite',
  ],
  ignoreIssues: {
    // Constants intentionally share the same value for semantic clarity
    'packages/@livestore/sync-cf/src/common/constants.ts': ['duplicates'],
  },
  ignoreExportsUsedInFile: true,
}

const runKnipCheck = Effect.gen(function* () {
  const workspaceRoot = yield* LivestoreWorkspace

  // Write config to temp file and run knip with it
  const tempConfigPath = path.join(os.tmpdir(), `knip-config-${Date.now()}.json`)
  yield* Effect.sync(() => fs.writeFileSync(tempConfigPath, JSON.stringify(knipConfig, null, 2)))

  yield* Effect.addFinalizer(() => Effect.sync(() => fs.unlinkSync(tempConfigPath)))

  yield* cmd(['scripts/node_modules/.bin/knip', '-c', tempConfigPath, '--directory', workspaceRoot]).pipe(
    Effect.provide(CurrentWorkingDirectory.fromPath(workspaceRoot)),
  )
}).pipe(Effect.scoped, Effect.withSpan('runKnipCheck'))

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
    yield* cmd('./scripts/node_modules/.bin/madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
    )

    // Check peer dependencies (warn-only for now, doesn't fail the build)
    const peerDepsOk = yield* runPeerDepCheck
    if (!peerDepsOk) {
      yield* Console.warn('Peer dependency check found violations (see above)')
    }

    // Check that .md files don't contain imports (should be .mdx)
    yield* checkMdFilesNoImports

    // Check for unused files, dependencies, and exports
    yield* runKnipCheck.pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  }),
)
