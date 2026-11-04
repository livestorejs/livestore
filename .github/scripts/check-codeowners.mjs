// Dependency-free matcher for the deliberately small CODEOWNERS glob subset used here.
// GitHub semantics: last match wins; an entry without owners clears earlier owners.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rules = readFileSync(new URL('../CODEOWNERS', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => {
    const [pattern, ...owners] = line.trim().split(/\s+/)
    return { pattern, owners: owners.join(' '), matches: compile(pattern) }
  })

function compile(pattern) {
  // Fail rather than silently reinterpret syntax not supported by this checker.
  assert(!/[!\\\[\]?#\s]/.test(pattern), `Unsupported CODEOWNERS syntax: ${pattern}`)
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
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${source}${directory ? '/.*$' : '(?:/.*)?$'}`)
}

assert(compile('**/vision.md').test('vision.md'))
assert(compile('**/vision.md').test('context/nested/vision.md'))
assert(!compile('/packages/@livestore/*/package.json').test('packages/@livestore/x/nested/package.json'))
assert(compile('/.github/').test('.github/nested/file.test.ts'))
assert(!compile('/.github/').test('nested/.github/file.ts'))
assert(compile('**/__tests__/').test('packages/x/__tests__/nested/file.ts'))

const delegated = [
  '.github/FUNDING.yml', 'nix/otel-dashboards/example.json', 'devenv.nix',
  'genie/validation.ts', 'scripts/src/commands/debug.ts', 'docs/astro.config.ts',
  'examples/web-todomvc/src/main.tsx', 'tests/package-common/src/example.ts',
  'contributor-docs/events-notation.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'package.json', 'package.json.genie.ts', 'pnpm-workspace.yaml.genie.ts',
  'packages/@livestore/livestore/src/mod.ts', 'packages/@local/example/src/main.ts',
  'packages/@local/example/package.json', 'context/spec.md', 'context/nested/spec.md',
  'CHANGELOG.md', 'packages/@livestore/wa-sqlite/CHANGELOG.md',
  'other/example.test.ts', 'other/example.test.tsx', 'other/example.test.js',
  'other/__tests__/nested/example.ts',
]
const retained = [
  'vision.md', 'context/vision.md', 'context/nested/requirements.md',
  'decisions/example.md', 'context/nested/decisions/example.md',
  '.decisions/example.md', 'packages/x/.decisions/example.test.ts',
  'context/05-contributing/01-collaboration/review-delegation.md',
  'context/03-delivery/02-release/ruleset-app-provisioning-runbook.md',
  'release/release-plan.json', 'release/nested/example.test.ts',
  '.changeset/config.json', '.changeset/config.json.genie.ts', '.changeset/example.md',
  'scripts/src/commands/changesets.ts', 'scripts/src/commands/release.ts',
  'scripts/src/commands/github.ts',
  'scripts/src/commands/release.test.ts', 'scripts/src/commands/devtools-artifact.test.ts',
  'scripts/src/shared/npm-publish.ts', 'scripts/src/shared/npm-publish.test.ts',
  'scripts/src/generated/release-topology.json', 'scripts/src/generated/release-topology.json.genie.ts',
  'genie/release-topology.ts', 'packages/@livestore/livestore/package.json',
  'packages/@livestore/livestore/package.json.genie.ts', '.npmrc', 'examples/x/.npmrc',
  '.envrc', 'examples/x/.env.local', 'examples/x/secrets/example.test.ts',
  'packages/x/credentials/config.json', '.infra/iac/netlify/env.tf',
  'scripts/src/meetings/google-calendar.ts', 'scripts/src/meetings/publish.ts',
  'scripts/src/shared/netlify.ts', '.github/CODEOWNERS', '.github/repo-settings.json',
  '.github/repo-settings.json.genie.ts', '.github/reconcile-app-manifest.json',
  '.github/workflows/ci.yml', '.github/workflows/ci.yml.genie.ts',
  '.github/scripts/check-codeowners.mjs', '.github/scripts/example.test.ts',
  '.github/actions/example/action.yml', '.github/labels.json.genie.ts',
  'genie/ci.ts', 'genie/ci-scripts/resolve-devenv.sh', 'genie/repo.ts',
  'genie/pr-snapshot-paths.ts', 'nix/devenv-modules/tasks/local/github-rulesets.nix',
  'genie/external.ts', 'genie/repo-topology.ts',
  'nix/devenv-modules/tasks/local/mono-wrappers.nix', 'SECURITY.md',
]

console.log('| Sample path (synthetic where necessary) | Final owner | Last matching pattern |')
console.log('| --- | --- | --- |')
const covered = new Set()
for (const [paths, expected] of [[delegated, ''], [retained, '@schickling']]) {
  for (const path of paths) {
    const matching = rules.filter((rule) => rule.matches.test(path))
    const last = matching.at(-1)
    assert.equal(last?.owners, expected, `Unexpected owner for ${path}`)
    covered.add(last.pattern)
    console.log(`| \`${path}\` | ${expected || 'none'} | \`${last.pattern}\` |`)
  }
}
for (const rule of rules) assert(covered.has(rule.pattern), `No final-match sample for ${rule.pattern}`)
console.log(`\nPASS: ${delegated.length + retained.length} samples; all ${rules.length} rules exercised as final matches.`)
