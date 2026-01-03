import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
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
    return yield* Effect.fail(new Error('Found .md files with imports'))
  }
}).pipe(Effect.withSpan('checkMdFilesNoImports'))

/**
 * Knip configuration for detecting unused files, dependencies, and exports.
 *
 * Note on disabled rules:
 * - duplicates: Disabled because constants like MAX_TRANSPORT_PAYLOAD_BYTES share values intentionally
 * - catalog: Disabled because catalog entries used in ignored workspaces (examples/tests/docs) appear unused
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
    '**/__tests__/**',
    '**/*.bundle.ts',
    '**/leader-thread-lazy.ts',
  ],
  ignoreDependencies: [
    'cloudflare',
    '@cloudflare/workers-types',
    '@types/chrome',
    '@types/wicg-file-system-access',
    '@types/web',
    'wrangler',
    '@effect/typeclass',
    '@effect/workflow',
    '@effect/vitest',
    '@astrojs/starlight',
    'jsdom',
    'vitest',
    'vite',
    '@opentelemetry/sdk-trace-base',
    '@biomejs/biome',
    'madge',
    '@livestore/utils-dev',
    '@livestore/peer-deps',
    '@livestore/sync-cf',
    '@standard-schema/spec',
    '@livestore/common',
  ],
  rules: {
    duplicates: 'off',
    catalog: 'off',
  },
  ignoreExportsUsedInFile: true,
}

const runKnipCheck = Effect.gen(function* () {
  const workspaceRoot = yield* LivestoreWorkspace

  // Write config to temp file and run knip with it
  const tempConfigPath = path.join(os.tmpdir(), `knip-config-${Date.now()}.json`)
  yield* Effect.sync(() => fs.writeFileSync(tempConfigPath, JSON.stringify(knipConfig, null, 2)))

  yield* Effect.addFinalizer(() => Effect.sync(() => fs.unlinkSync(tempConfigPath)))

  yield* cmd(`scripts/node_modules/.bin/knip -c ${tempConfigPath}`).pipe(
    Effect.provide(LivestoreWorkspace.fromPath(workspaceRoot)),
  )
}).pipe(Effect.scoped, Effect.withSpan('runKnipCheck'))

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

    // Check for unused files, dependencies, and exports
    yield* runKnipCheck.pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  }),
)
