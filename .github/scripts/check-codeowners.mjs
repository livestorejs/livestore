// Dependency-free matcher for the deliberately small CODEOWNERS glob subset used here.
// GitHub semantics: last match wins; an entry without owners clears earlier owners.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

export const compile = (pattern) => {
  // Fail rather than silently reinterpret syntax not supported by this checker.
  assert(!/[!\\[\]?#\s]/.test(pattern), `Unsupported CODEOWNERS syntax: ${pattern}`)
  const anchored = pattern.startsWith('/') || pattern.replace(/\/$/, '').includes('/')
  const directory = pattern.endsWith('/')
  const glob = pattern.replace(/^\//, '').replace(/\/$/, '')
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    if (glob.slice(i, i + 3) === '**/') {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.slice(i, i + 2) === '**') {
      source += '.*'
      i++
    } else if (glob[i] === '*') {
      source += '[^/]*'
    } else {
      source += glob[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${anchored === true ? '^' : '(?:^|/)'}${source}${directory === true ? '/.*$' : '(?:/.*)?$'}`)
}
export const rules = readFileSync(new URL('../CODEOWNERS', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => {
    const [pattern, ...owners] = line.trim().split(/\s+/)
    return { pattern, owners: owners.join(' '), matches: compile(pattern) }
  })

if (import.meta.main) {
  assert(compile('**/vision.md').test('vision.md'))
  assert(compile('**/vision.md').test('context/nested/vision.md'))
  assert(!compile('/packages/@livestore/*/package.json').test('packages/@livestore/x/nested/package.json'))
  assert(compile('/.github/').test('.github/nested/file.test.ts'))
  assert(!compile('/.github/').test('nested/.github/file.ts'))
  assert(compile('**/__tests__/').test('packages/x/__tests__/nested/file.ts'))

  const delegated = [
    '.github/FUNDING.yml',
    'tests/package-common/src/example.ts',
    'tests/sync-provider/src/sync-provider.test.ts',
    'contributor-docs/events-notation.md',
    'packages/@livestore/livestore/src/mod.ts',
    'packages/@livestore/adapter-web/src/index.ts',
    'packages/@livestore/adapter-cloudflare/src/mod.ts',
    'packages/@livestore/react/src/mod.ts',
    'packages/@livestore/sqlite-wasm/src/mod.ts',
    'packages/@local/example/src/main.ts',
    'context/spec.md',
    'context/nested/spec.md',
    'CHANGELOG.md',
    'packages/@livestore/wa-sqlite/CHANGELOG.md',
    'other/example.test.ts',
    'other/example.test.tsx',
    'other/example.test.js',
    'other/__tests__/nested/example.ts',
  ]
  const retained = [
    'vision.md',
    'context/vision.md',
    'context/nested/requirements.md',
    'decisions/example.md',
    'context/nested/decisions/example.md',
    '.decisions/example.md',
    'packages/x/.decisions/example.test.ts',
    'context/05-contributing/01-collaboration/review-delegation.md',
    'context/03-delivery/02-release/ruleset-app-provisioning-runbook.md',
    'release/release-plan.json',
    'release/nested/example.test.ts',
    '.changeset/config.json',
    '.changeset/config.json.genie.ts',
    '.changeset/example.md',
    'scripts/bin/mono',
    'scripts/src/mono.ts',
    'scripts/src/commands/docs.ts',
    'scripts/src/commands/examples/deploy-examples.ts',
    'scripts/src/commands/github.ts',
    'scripts/src/commands/release.test.ts',
    'scripts/src/shared/npm-publish.test.ts',
    'scripts/src/shared/cloudflare.ts',
    'scripts/src/shared/netlify.ts',
    'scripts/src/meetings/publish.ts',
    'scripts/src/meetings/report-status.ts',
    'scripts/src/meetings/publication-status.ts',
    'genie/repo.ts',
    'genie/ci-scripts/resolve-devenv.sh',
    'nix/devenv-modules/tasks/local/mono-wrappers.nix',
    'devenv.nix',
    'devenv.lock',
    'docs/astro.config.ts',
    'docs/ec.config.mjs',
    'docs/src/content/docs/example.mdx',
    'examples/web-todomvc/vite.config.ts',
    'examples/web-todomvc/src/main.tsx',
    'tests/integration/playwright.config.ts',
    'tests/integration/example.test.ts',
    'tests/sync-provider/src/providers/cloudflare-do-rpc.ts',
    'tests/sync-provider/src/prepare-ci.ts',
    'tests/sync-provider/src/types.ts',
    'packages/@livestore/common/src/index.ts',
    'packages/@livestore/common/src/example.test.ts',
    'packages/@livestore/common-cf/src/mod.ts',
    'packages/@livestore/effect-playwright/src/index.ts',
    'packages/@livestore/utils/src/mod.ts',
    'packages/@livestore/utils-dev/src/node/mod.ts',
    'packages/@livestore/webmesh/src/mod.ts',
    'packages/@livestore/sync-cf/src/client/mod.ts',
    'packages/@livestore/sync-cf/src/common/mod.ts',
    'packages/@local/astro-tldraw/src/mod.ts',
    'packages/@local/astro-twoslash-code/src/mod.ts',
    'packages/@local/shared/src/contributor-meeting.ts',
    'packages/@local/shared/src/contributor-meeting-failure.ts',
    'package.json',
    'packages/@local/shared/package.json',
    'packages/@livestore/livestore/package.json',
    'tsconfig.dev.json',
    'packages/@local/astro-twoslash-code/example/tsconfig.shared.ts',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'pnpm-install-contract.json',
    'megarepo.lock',
    '.npmrc',
    'examples/x/.npmrc',
    '.envrc',
    'examples/x/.env.local',
    'examples/x/secrets/example.test.ts',
    'packages/x/credentials/config.json',
    '.infra/iac/netlify/env.tf',
    '.github/CODEOWNERS',
    '.github/repo-settings.json',
    '.github/reconcile-app-manifest.json',
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yml.genie.ts',
    '.github/scripts/check-credential-closure.mjs',
    '.github/scripts/example.test.ts',
    '.github/actions/example/action.yml',
    'packages/@local/shared/package.json.genie.ts',
    'tests/perf/package.json.genie.ts',
    'patches/starlight-markdown@0.1.5.patch',
    'SECURITY.md',
  ]

  console.log('| Sample path (synthetic where necessary) | Final owner | Last matching pattern |')
  console.log('| --- | --- | --- |')
  const covered = new Set()
  for (const [paths, expected] of [
    [delegated, ''],
    [retained, '@schickling'],
  ]) {
    for (const path of paths) {
      const last = rules.findLast((rule) => rule.matches.test(path))
      assert.equal(last?.owners, expected, `Unexpected owner for ${path}`)
      covered.add(last.pattern)
      console.log(`| \`${path}\` | ${expected === '' ? 'none' : expected} | \`${last.pattern}\` |`)
    }
  }
  for (const rule of rules) assert(covered.has(rule.pattern), `No final-match sample for ${rule.pattern}`)
  console.log(
    `\nPASS: ${delegated.length + retained.length} samples; all ${rules.length} rules exercised as final matches.`,
  )
}
