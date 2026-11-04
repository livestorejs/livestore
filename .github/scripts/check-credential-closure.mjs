// Run with Bun: native YAML parsing and TS/JS import scanning; no source is executed.
// Conservative runtime roots include launchers, setup generators, and deploy plugins.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rules } from './check-codeowners.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const tracked = new Set(files)
const text = (path) => readFileSync(resolve(root, path), 'utf8')
const workspaceGlobs = Bun.YAML.parse(text('pnpm-workspace.yaml')).packages.map((pattern) => new Bun.Glob(pattern))
const packages = new Map(files.filter((p) => p.endsWith('/package.json') &&
  workspaceGlobs.some((glob) => glob.match(dirname(p)))).map((path) => {
  const data = JSON.parse(text(path))
  return [data.name, { path, data }]
}))
const source = /\.(?:[cm]?[jt]sx?|astro|mdx)$/
const seeds = new Map()
const scanSeeds = new Set()
const add = (path, reason, scan = true) => {
  assert(tracked.has(path), `Untracked executable input ${path} (${reason})`)
  if (!seeds.has(path)) seeds.set(path, reason)
  if (scan && source.test(path)) scanSeeds.add(path)
}
// Nix setup runs genie; Netlify rebuilds docs with its token; Cloudflare builds
// each example with its token. Retain the dynamic plugin discovery directories.
const surfaces = ['scripts/', 'genie/', 'nix/', 'docs/', 'examples/', '.infra/', 'tests/integration/']
for (const path of files) {
  if (surfaces.some((prefix) => path.startsWith(prefix)) || path.endsWith('.genie.ts') ||
      /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json)$/.test(path) || /(?:^|\/)(?:pnpm[^/]*|megarepo\.(?:kdl|lock)|devenv\.[^/]+)$/.test(path) ||
      path.startsWith('patches/')) add(path, 'privileged setup/deploy surface',
        path.endsWith('.genie.ts') ||
        (path.startsWith('tests/integration/') && (path.endsWith('.play.ts') || /\/(?:playwright|vite)\.config\.[^/]+$/.test(path))) ||
        (path.startsWith('docs/') && !path.includes('/content/_assets/code/') &&
          (/\.(?:astro|mdx)$/.test(path) || path.startsWith('docs/scripts/') || /\/[^/]*config\.[^/]+$/.test(path))) ||
        (path.startsWith('examples/') && (/\/vite\.config\.[^/]+$/.test(path) || path.includes('/scripts/'))))
}
add('scripts/src/mono.ts', 'scripts/bin/mono launcher')
// Inventory every job with a write token or non-telemetry secret, including
// inherited workflow permissions. Telemetry-only access is an explicit accepted risk.
console.log('| Workflow/job | Credential or write permission |')
console.log('| --- | --- |')
let jobs = 0
for (const path of files.filter((p) => p.startsWith('.github/workflows/') && p.endsWith('.yml'))) {
  const workflow = Bun.YAML.parse(text(path))
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    const serialized = JSON.stringify(job)
    const secrets = [...serialized.matchAll(/secrets\.([A-Z_0-9]+)/g)].map((m) => m[1])
      .filter((key) => !key.startsWith('GRAFANA_CLOUD_OTLP_'))
    const permissions = job.permissions ?? workflow.permissions ?? {}
    const writes = Object.entries(permissions).filter(([, value]) => value === 'write').map(([key]) => `${key}:write`)
    if (secrets.length === 0 && writes.length === 0 && !serialized.includes('GH_TOKEN')) continue
    jobs++
    console.log(`| ${path.split('/').at(-1)}/${name} | ${[...new Set([...secrets, ...writes])].join(', ') || 'GH_TOKEN'} |`)
    add(path, `credentialed job ${name}`)
    for (const step of job.steps ?? []) {
      // Literal repository commands/assets in shell steps. Nonliteral dispatch
      // through mono/Nix is covered by the conservative surfaces above.
      for (const token of JSON.stringify(step).matchAll(/(?:scripts|genie|docs|examples|packages|nix|\.github)\/[A-Za-z0-9_@./-]+/g)) {
        if (tracked.has(token[0])) add(token[0], `${path}:${name}`)
      }
    }
  }
}

function candidates(path) {
  return [path, ...['.ts', '.tsx', '.js', '.mjs', '.json'].map((ext) => path + ext),
    ...['.ts', '.tsx', '.js', '.mjs'].map((ext) => `${path}/index${ext}`),
    ...(path.endsWith('.js') ? [path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx'] : [])]
}
function targets(value) {
  if (typeof value === 'string') return [value]
  return value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []
}
function resolveImport(specifier, importer) {
  specifier = specifier.split('?')[0]
  if (specifier.startsWith('.')) {
    if (posix.normalize(posix.join(dirname(importer), specifier)).startsWith('repos/')) return ['megarepo.lock', 'megarepo.kdl']
    const path = candidates(posix.normalize(posix.join(dirname(importer), specifier))).find((p) => tracked.has(p))
    assert(path, `Unresolved relative import ${specifier} in ${importer}`)
    return [path]
  }
  if (specifier.startsWith('#mr/')) return ['megarepo.lock', 'megarepo.kdl']
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  const pkg = packages.get(name)
  if (!pkg) {
    assert(!specifier.startsWith('@local/'), `Unresolved local package ${specifier} in ${importer}`)
    return [] // external dependency bytes are controlled by retained manifests/lockfiles
  }
  const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  const exports = pkg.data.exports
  let values = typeof exports === 'string' ? (subpath === '.' ? [exports] : []) : targets(exports?.[subpath])
  if (values.length === 0 && subpath !== '.') {
    for (const [key, value] of Object.entries(exports ?? {})) {
      if (!key.includes('*')) continue
      const [before, after] = key.split('*')
      if (subpath.startsWith(before) && subpath.endsWith(after)) {
        const match = subpath.slice(before.length, after ? -after.length : undefined)
        values.push(...targets(value).map((target) => target.replaceAll('*', match)))
      }
    }
  }
  if (values.length === 0 && subpath === '.') values = [pkg.data.module ?? pkg.data.main ?? './index.ts']
  const paths = values.flatMap((value) => {
    const path = candidates(posix.join(dirname(pkg.path), value)).find((p) => tracked.has(p))
    assert(path, `Unresolved workspace export ${specifier} -> ${value} in ${importer}`)
    return [path]
  })
  assert(paths.length, `Unresolved workspace subpath ${specifier} in ${importer}`)
  return [pkg.path, ...paths]
}
function moduleText(path) {
  let code = text(path).replace(/^#![^\n]*\n/, '')
  if (path.endsWith('.astro')) return code.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  if (path.endsWith('.mdx')) {
    // MDX executes top-level ESM, not fenced documentation examples.
    code = code.replace(/^(?:```|~~~)[\s\S]*?^(?:```|~~~).*$/gm, '')
    const lines = code.split('\n')
    const modules = []
    for (let i = 0; i < lines.length; i++) {
      if (!/^(?:import|export)\s/.test(lines[i])) continue
      let statement = lines[i]
      while (true) {
        try {
          new Bun.Transpiler({ loader: 'tsx' }).transformSync(statement)
          modules.push(statement)
          break
        } catch (error) {
          assert(i + 1 < lines.length, `Cannot parse MDX module in ${path}: ${error}`)
          statement += '\n' + lines[++i]
        }
      }
    }
    return modules.join('\n')
  }
  return code
}
const closure = new Map(seeds)
const edges = []
const pending = [...scanSeeds]
const scanned = new Set()
function assertMarkdownDataImport(specifier, importer) {
  if (/\.(?:md|markdown)(?:\?|$)/i.test(specifier)) {
    assert(/(?:\?|&)raw(?:&|$)/.test(specifier),
      `Executable Markdown import ${specifier} in ${importer}: use ?raw and the protected text renderer; frontmatter can select arbitrary layout code`)
  }
}
// Regression: a plain Markdown edge can select a new ownerless package layout;
// checking only its present frontmatter or selected module's existence is unsafe.
assert.throws(() => assertMarkdownDataImport('../../../CHANGELOG.md', 'docs/src/pages/changelog.astro'),
  /Executable Markdown import/)
assert.throws(() => assertMarkdownDataImport('new.markdown?url', 'docs/example.ts'),
  /Executable Markdown import/)
assert.doesNotThrow(() => assertMarkdownDataImport('../../../CHANGELOG.md?raw', 'docs/src/pages/changelog.astro'))
for (const path of pending) {
  if (scanned.has(path)) continue
  scanned.add(path)
  if (!source.test(path)) continue
  const loader = /\.(?:tsx|jsx|mdx|astro)$/.test(path) ? 'tsx' : 'ts'
  const parser = new Bun.Transpiler({ loader })
  // Native scanning omits explicit type-only imports but preserves value imports,
  // including unused bindings whose module initialization can still run in Node.
  for (const entry of parser.scanImports(moduleText(path))) {
    assertMarkdownDataImport(entry.path, path)
    for (const target of resolveImport(entry.path, path)) {
      edges.push([path, target])
      if (!source.test(target) && !seeds.has(target)) continue // inert imported assets, not code
      if (!closure.has(target)) closure.set(target, `imported by ${path}`)
      // These Vite/plugin queries produce inert strings/assets, not executable imports.
      if (source.test(target) && !/\?(?:snippet|raw|url|tldraw)(?:[&#]|$)/.test(entry.path)) pending.push(target)
    }
  }
}
const packageFiles = [...closure.keys()].filter((path) => path.startsWith('packages/') && source.test(path) && !path.endsWith('.genie.ts'))
console.log('\n| Imported package file | Importing root/edge |')
console.log('| --- | --- |')
for (const path of packageFiles.sort()) console.log(`| ${path} | ${closure.get(path)} |`)
if (!process.argv.includes('--inventory')) {
  const unowned = [...closure].filter(([path]) =>
    rules.filter((rule) => rule.matches.test(path)).at(-1)?.owners !== '@schickling')
  assert.deepEqual(unowned, [], 'Ownerless executable credential inputs (path, importing edge)')
}
console.log(`\n${process.argv.includes('--inventory') ? 'INVENTORY' : 'PASS'}: ${jobs} credentialed jobs; ${closure.size} retained inputs; ${edges.length} import edges; ${packageFiles.length} package source files.`)
