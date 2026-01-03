import { Effect } from '@livestore/utils/effect'
import { cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { runPeerDepCheck } from '../../shared/peer-deps.ts'
import { CheckEventPubSub } from '../events.ts'
import { runCommandWithEvents } from '../runner.ts'
import type { Check } from './types.ts'

/**
 * Biome linting and formatting check.
 */
export const biomeCheck: Check = {
  type: 'lint',
  name: 'Biome',
  fast: true,
  run: runCommandWithEvents('lint', 'Biome', 'biome check scripts tests packages docs examples --error-on-warnings', {
    shell: true,
  }).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
}

/**
 * Syncpack dependency version consistency check.
 */
export const syncpackCheck: Check = {
  type: 'lint',
  name: 'Syncpack',
  fast: true,
  run: runCommandWithEvents('lint', 'Syncpack', 'syncpack lint').pipe(Effect.provide(LivestoreWorkspace.toCwd())),
}

/**
 * Circular dependency detection via madge.
 * This is the slowest lint check, so it's excluded from the fast path.
 */
export const madgeCheck: Check = {
  type: 'lint',
  name: 'Circular Deps',
  fast: false, // Excluded from fast path
  run: runCommandWithEvents('lint', 'Circular Deps', 'madge --circular --no-spinner examples/*/src packages/*/*/src', {
    shell: true,
  }).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
}

/**
 * Peer dependency consistency check.
 * This is a warn-only check that doesn't fail the build.
 */
export const peerDepsCheck: Check = {
  type: 'lint',
  name: 'Peer Deps',
  fast: true,
  run: Effect.gen(function* () {
    yield* CheckEventPubSub.publishOutput('lint', 'Peer Deps', 'stdout', 'Checking peer dependencies...')
    const peerDepsOk = yield* runPeerDepCheck
    if (!peerDepsOk) {
      yield* CheckEventPubSub.publishOutput(
        'lint',
        'Peer Deps',
        'stderr',
        'Peer dependency check found violations (see above)',
      )
    } else {
      yield* CheckEventPubSub.publishOutput('lint', 'Peer Deps', 'stdout', 'All peer dependencies are consistent')
    }
    // Note: This check doesn't fail the build, it's warn-only
  }).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
}

/**
 * Check that .md files don't contain ESM import statements.
 * Files with imports must use .mdx extension.
 */
export const mdImportsCheck: Check = {
  type: 'lint',
  name: 'MD Imports',
  fast: true,
  run: Effect.gen(function* () {
    yield* CheckEventPubSub.publishOutput('lint', 'MD Imports', 'stdout', 'Checking .md files for imports...')

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
      yield* CheckEventPubSub.publishOutput(
        'lint',
        'MD Imports',
        'stderr',
        `Found .md files with import statements. These must be renamed to .mdx:`,
      )
      for (const file of filesWithImports) {
        yield* CheckEventPubSub.publishOutput('lint', 'MD Imports', 'stderr', `  - ${file}`)
      }
      return yield* Effect.fail(new Error('Found .md files with imports'))
    }

    yield* CheckEventPubSub.publishOutput('lint', 'MD Imports', 'stdout', 'No .md files with imports found')
  }),
}

/**
 * All fast lint checks (for default `mono check`).
 */
export const fastLintChecks: Check[] = [biomeCheck, syncpackCheck, peerDepsCheck, mdImportsCheck]

/**
 * All slow lint checks (only run with `--full`).
 */
export const slowLintChecks: Check[] = [madgeCheck]

/**
 * All lint checks.
 */
export const allLintChecks: Check[] = [...fastLintChecks, ...slowLintChecks]
