import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const assertStablePlan = (plan) => {
  if (plan.schemaVersion !== 1 || plan.npmTag !== 'latest' || /^\d+\.\d+\.\d+$/.test(plan.version) === false) {
    throw new Error('Stable docs promotion requires a schemaVersion 1 stable latest release plan')
  }
}

export const assertPublishedPackage = ({ name, version, publishedVersion, latest }) => {
  if (publishedVersion !== version) throw new Error(`${name}@${version} is not published on npm`)
  if (latest !== version) throw new Error(`${name} latest is ${latest}, expected ${version}`)
}

const command = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

export const assertReleaseAncestor = (tag, head, cwd = process.cwd()) => {
  execFileSync('git', ['merge-base', '--is-ancestor', `${tag}^{commit}`, head], { cwd, stdio: 'pipe' })
}

export const validateStableDocsRelease = (head) => {
  const plan = JSON.parse(readFileSync('release/release-plan.json', 'utf8'))
  const topology = JSON.parse(readFileSync('scripts/src/generated/release-topology.json', 'utf8'))
  assertStablePlan(plan)
  if (/^[a-f0-9]{40}$/.test(head) === false) throw new Error('Expected the exact 40-character PR head SHA')
  if (topology.publishablePackages.length === 0) throw new Error('Release topology has no publishable packages')

  // The plan has no commit field: the published version's release tag identifies
  // its commit. Full history is needed to prove ancestry, not merely tag presence.
  if (command('git', ['rev-parse', '--is-shallow-repository']) === 'true') {
    command('git', ['fetch', '--unshallow', 'origin'])
  }
  const tag = `v${plan.version}`
  command('git', ['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
  assertReleaseAncestor(tag, head)
  for (const { name } of topology.publishablePackages) {
    const publishedVersion = JSON.parse(command('npm', ['view', `${name}@${plan.version}`, 'version', '--json']))
    const latest = JSON.parse(command('npm', ['view', name, 'dist-tags.latest', '--json']))
    assertPublishedPackage({ name, version: plan.version, publishedVersion, latest })
  }
  console.log(
    `Validated ${topology.publishablePackages.length} published packages at latest=${plan.version}; ${tag} is an ancestor of ${head}`,
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateStableDocsRelease(process.argv[2])
}
