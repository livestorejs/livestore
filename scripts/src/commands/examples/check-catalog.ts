import fs from 'node:fs'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

/**
 * The examples are standalone, hand-maintained projects (not genie-managed) so a user can copy
 * them and run them as-is. That very property let their dependency versions silently drift from the
 * monorepo catalog. These commands keep the examples aligned to the catalog without turning them
 * into generated artifacts: {@link checkCatalogCommand} is a CI gate that fails on drift, and
 * {@link alignCatalogCommand} rewrites the example manifests to the catalog versions.
 */

const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)

/**
 * Dependencies intentionally allowed to differ from the catalog in examples. Keep this minimal and
 * documented.
 *
 * - `vite` / `@vitejs/plugin-react`: the catalog is on vite 8 (Rolldown bundler), but the example
 *   plugin ecosystem is not ready yet — `rwsdk/vite` (web-todomvc-redwood) fails to build under
 *   Rolldown and the published `@livestore/devtools-vite` still uses vite-7 config APIs. Keep the
 *   examples on the vite-7 line until the ecosystem supports vite 8, then remove this exception.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>(['vite', '@vitejs/plugin-react'])

const loadCatalog = Effect.fn('examples/loadCatalog')(function* () {
  // The composed genie catalog lives behind genie's `#mr/` import map which is not resolvable from
  // the plain bun runtime, so read the effect-utils catalog directly from the materialized member.
  // It is the source of every external (non-@livestore) version the examples consume.
  const mod = (yield* Effect.promise(() => import(`${workspaceRoot}/repos/effect-utils/genie/external.ts`))) as {
    catalog: Record<string, unknown>
  }
  return Object.fromEntries(
    Object.entries(mod.catalog).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
})

const exampleManifests = (): ReadonlyArray<{ slug: string; path: string }> => {
  const examplesDir = `${workspaceRoot}/examples`
  return fs
    .readdirSync(examplesDir)
    .map((slug) => ({ slug, path: `${examplesDir}/${slug}/package.json` }))
    .filter(({ path }) => fs.existsSync(path))
}

const collectDrift = (catalog: Record<string, string>) => {
  const drift: { slug: string; name: string; have: string; want: string }[] = []
  for (const { slug, path } of exampleManifests()) {
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, Record<string, string> | undefined>
    for (const section of ['dependencies', 'devDependencies'] as const) {
      for (const [name, have] of Object.entries(pkg[section] ?? {})) {
        const want = catalog[name]
        if (want === undefined) continue
        if (name.startsWith('@livestore/') === true) continue
        if (typeof have !== 'string' || have.startsWith('workspace') === true || have.startsWith('catalog') === true)
          continue
        if (ALLOWLIST.has(name) === true) continue
        if (have !== want) drift.push({ slug, name, have, want })
      }
    }
  }
  return drift
}

export const checkCatalogCommand = Cli.Command.make(
  'check-catalog',
  {},
  Effect.fn(function* () {
    const catalog = yield* loadCatalog()
    const drift = collectDrift(catalog)
    if (drift.length > 0) {
      yield* Effect.logError(
        `Example dependencies drifted from the catalog (${drift.length}):\n` +
          drift.map((d) => `  ${d.slug}: ${d.name} ${d.have} → catalog ${d.want}`).join('\n') +
          `\n\nRun 'mono examples align-catalog' to fix, or allowlist intentional exceptions in check-catalog.ts.`,
      )
      return yield* Effect.fail(new Error(`${drift.length} example dependency drift(s) from catalog`))
    }
    yield* Effect.log('All example dependencies match the catalog ✓')
  }),
)

export const alignCatalogCommand = Cli.Command.make(
  'align-catalog',
  {},
  Effect.fn(function* () {
    const catalog = yield* loadCatalog()
    let changed = 0
    for (const { slug, path } of exampleManifests()) {
      const raw = fs.readFileSync(path, 'utf8')
      const pkg = JSON.parse(raw) as Record<string, Record<string, string> | undefined>
      let touched = false
      for (const section of ['dependencies', 'devDependencies'] as const) {
        const deps = pkg[section]
        if (deps === undefined) continue
        for (const [name, have] of Object.entries(deps)) {
          const want = catalog[name]
          if (want === undefined || name.startsWith('@livestore/') === true) continue
          if (
            have.startsWith('workspace') === true ||
            have.startsWith('catalog') === true ||
            ALLOWLIST.has(name) === true
          )
            continue
          if (have !== want) {
            deps[name] = want
            touched = true
          }
        }
      }
      if (touched === true) {
        fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
        changed += 1
        yield* Effect.log(`Aligned ${slug}`)
      }
    }
    yield* Effect.log(changed === 0 ? 'Examples already aligned to the catalog ✓' : `Aligned ${changed} example(s)`)
  }),
)
