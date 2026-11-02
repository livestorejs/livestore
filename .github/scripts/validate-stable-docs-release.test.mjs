import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { assertPublishedPackage, assertReleaseAncestor, assertStablePlan } from './validate-stable-docs-release.mjs'

test('stable promotion accepts only a stable latest plan', () => {
  assertStablePlan({ schemaVersion: 1, version: '0.5.0', npmTag: 'latest' })
  for (const plan of [
    { schemaVersion: 1, version: '0.5.0-dev.0', npmTag: 'latest' },
    { schemaVersion: 1, version: '0.5.0', npmTag: 'dev' },
    { schemaVersion: 2, version: '0.5.0', npmTag: 'latest' },
  ])
    assert.throws(() => assertStablePlan(plan))
})

test('already-published latest package is accepted for stable promotion', () => {
  assertPublishedPackage({ name: '@livestore/common', version: '0.5.0', publishedVersion: '0.5.0', latest: '0.5.0' })
})

test('missing version and mismatched latest fail stable promotion', () => {
  assert.throws(() =>
    assertPublishedPackage({
      name: '@livestore/common',
      version: '0.5.0',
      publishedVersion: undefined,
      latest: '0.5.0',
    }),
  )
  assert.throws(() =>
    assertPublishedPackage({ name: '@livestore/common', version: '0.5.0', publishedVersion: '0.5.0', latest: '0.4.0' }),
  )
})

test('workflow scopes published validation to docs/stable and keeps main rehearsal', () => {
  const source = readFileSync(new URL('../workflows/release.yml.genie.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /name: 'Dry-run stable package publish',\s+if: "github.event_name != 'pull_request' \|\| github.base_ref != 'docs\/stable'",\s+run: runDevenvTasksBefore\('release:stable:dryrun'\)/,
  )
  assert.match(
    source,
    /name: 'Validate published stable docs release',\s+if: "github.event_name == 'pull_request' && github.base_ref == 'docs\/stable'"/,
  )
  assert.match(source, /if \[ "\$GITHUB_BASE_REF" = "docs\/stable" \]; then\s+exit 0\s+fi/)
  const release = readFileSync(new URL('../../scripts/src/commands/release.ts', import.meta.url), 'utf8')
  assert.match(
    release,
    /if \(dryRun === true \|\| allowExisting === false\) \{\s+return yield\* new ReleaseError\(\{ message: `\$\{pkg\}@\$\{version\} already exists on npm` \}\)/,
  )
})

test('published tag must be an ancestor of the exact promotion head', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stable-docs-ancestry-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
  try {
    git('init')
    git('config', 'core.hooksPath', '/dev/null')
    git('config', 'user.name', 'Release test')
    git('config', 'user.email', 'release-test@example.com')
    git('commit', '--allow-empty', '-m', 'published release')
    git('tag', 'v0.5.0')
    git('commit', '--allow-empty', '-m', 'stable docs promotion')
    const head = git('rev-parse', 'HEAD')
    assertReleaseAncestor('v0.5.0', head, cwd)
    git('checkout', '--orphan', 'unrelated')
    git('commit', '--allow-empty', '-m', 'unrelated history')
    assert.throws(() => assertReleaseAncestor('v0.5.0', git('rev-parse', 'HEAD'), cwd))
    assert.throws(() => assertReleaseAncestor('v9.9.9', head, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
