import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

type CompatibleLivestore =
  | { readonly kind: 'range'; readonly range: string }
  | { readonly kind: 'snapshot'; readonly gitSha: string; readonly version: string }

type ArtifactMetadata = {
  readonly schemaVersion: 1
  readonly artifactName: 'livestore-devtools-vite'
  readonly packageName: '@livestore/devtools-vite'
  readonly devtoolsVersion: string
  readonly devtoolsBuildId: string
  readonly compatibleLivestore: CompatibleLivestore
  readonly files: {
    readonly tarball: {
      readonly name: string
      readonly sha256: string
      readonly integrity: string
    }
  }
}

type ArtifactManifest = {
  readonly schemaVersion: 1
  readonly artifact: {
    readonly metadataUrl: string
    readonly tarballUrl: string
    readonly sha256?: string
  }
}

const usage = `Usage:
  bun scripts/src/commands/devtools-artifact.ts verify (--manifest <file> | --metadata <url-or-file> --tarball <url-or-file>)
  bun scripts/src/commands/devtools-artifact.ts repack (--manifest <file> | --metadata <url-or-file> --tarball <url-or-file>) --version <version> [--dry-run|--publish]

Options:
  --manifest <file>        Checked-in public artifact manifest
  --metadata <url-or-file>  Public release-metadata.json URL or local path
  --tarball <url-or-file>   Public artifact tarball URL or local path
  --version <version>       LiveStore release-group package version for repack
  --out-dir <dir>           Output directory for verified/repacked artifacts
  --dry-run                 Run npm publish dry-run for the repacked package
  --publish                 Publish the repacked package to npm
`

const parseArgs = (argv: ReadonlyArray<string>) => {
  const [maybeCommand = 'help', ...maybeRest] = argv
  const firstArgIsFlag = maybeCommand.startsWith('--') === true
  const command = firstArgIsFlag === true ? 'help' : maybeCommand
  const rest = firstArgIsFlag === true ? argv : maybeRest
  const flags = new Map<string, string | true>()

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!
    if (arg.startsWith('--') === false) throw new Error(`Unexpected positional argument: ${arg}`)
    const name = arg.slice(2)
    const next = rest[index + 1]
    if (next !== undefined && next.startsWith('--') === false) {
      flags.set(name, next)
      index++
    } else {
      flags.set(name, true)
    }
  }

  return { command, flags }
}

const readFlag = (flags: Map<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name)
  if (value === true) throw new Error(`--${name} requires a value`)
  return value
}

const hasFlag = (flags: Map<string, string | true>, name: string): boolean => flags.get(name) === true

const run = (command: ReadonlyArray<string>, options: { readonly cwd?: string } = {}) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: options.cwd,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? 'signal'}): ${command.join(' ')}`)
}

const runCapture = (command: ReadonlyArray<string>, options: { readonly cwd?: string } = {}) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'signal'}): ${command.join(' ')}\n${result.stderr}`)
  }
  return result.stdout
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const integrity = (file: string) => `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`

const downloadToFile = async (source: string, target: string, redirects = 0): Promise<void> => {
  if (redirects > 5) throw new Error(`Too many redirects while fetching ${source}`)

  await new Promise<void>((resolve, reject) => {
    const get = source.startsWith('https://') === true ? httpsGet : httpGet
    const request = get(source, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location

      if (status >= 300 && status < 400 && location !== undefined) {
        response.resume()
        downloadToFile(new URL(location, source).toString(), target, redirects + 1).then(resolve, reject)
        return
      }

      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`Failed to fetch ${source}: ${status}`))
        return
      }

      pipeline(response, createWriteStream(target)).then(resolve, reject)
    })
    request.on('error', reject)
  })
}

const fetchToFile = async (source: string, target: string) => {
  mkdirSync(path.dirname(target), { recursive: true })
  if (source.startsWith('http://') === true || source.startsWith('https://') === true) {
    await downloadToFile(source, target)
    return
  }

  const sourcePath = path.resolve(source)
  writeFileSync(target, readFileSync(sourcePath))
}

const prepareInputs = async (flags: Map<string, string | true>) => {
  const manifestSource = readFlag(flags, 'manifest')
  let metadataSource = readFlag(flags, 'metadata')
  let tarballSource = readFlag(flags, 'tarball')
  let expectedTarballSha256: string | undefined

  if (manifestSource !== undefined) {
    if (metadataSource !== undefined || tarballSource !== undefined) {
      throw new Error('--manifest cannot be combined with --metadata or --tarball')
    }
    const manifest = JSON.parse(readFileSync(path.resolve(manifestSource), 'utf8')) as ArtifactManifest
    if (manifest.schemaVersion !== 1) throw new Error('Unsupported artifact manifest schemaVersion')
    metadataSource = manifest.artifact.metadataUrl
    tarballSource = manifest.artifact.tarballUrl
    expectedTarballSha256 = manifest.artifact.sha256
  }

  if (metadataSource === undefined) throw new Error('--metadata or --manifest is required')
  if (tarballSource === undefined) throw new Error('--tarball or --manifest is required')

  const workDir = path.resolve(readFlag(flags, 'out-dir') ?? mkdtempSync(path.join(tmpdir(), 'livestore-devtools-')))
  const metadataPath = path.join(workDir, 'release-metadata.json')
  const tarballPath = path.join(workDir, 'livestore-devtools-vite.tgz')
  await fetchToFile(metadataSource, metadataPath)
  await fetchToFile(tarballSource, tarballPath)
  if (expectedTarballSha256 !== undefined && sha256(tarballPath) !== expectedTarballSha256) {
    throw new Error('Manifest tarball SHA-256 mismatch')
  }

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ArtifactMetadata
  return { workDir, metadata, metadataPath, tarballPath }
}

const forbiddenPatterns: ReadonlyArray<string | RegExp> = [
  '/home/',
  '/Users/',
  'op://',
  /npm_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'BEGIN PRIVATE KEY',
]

const forbiddenPatternName = (pattern: string | RegExp) => (typeof pattern === 'string' ? pattern : pattern.source)

const containsForbiddenPattern = (content: string, pattern: string | RegExp) =>
  typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)

const assertMetadata = (metadata: ArtifactMetadata, tarballPath: string) => {
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported metadata schemaVersion')
  if (metadata.artifactName !== 'livestore-devtools-vite') throw new Error('Unexpected artifactName')
  if (metadata.packageName !== '@livestore/devtools-vite') throw new Error('Unexpected packageName')
  if (metadata.files.tarball.sha256 !== sha256(tarballPath)) throw new Error('Tarball SHA-256 mismatch')
  if (metadata.files.tarball.integrity !== integrity(tarballPath)) throw new Error('Tarball integrity mismatch')

  const serialized = JSON.stringify(metadata)
  for (const pattern of forbiddenPatterns) {
    if (containsForbiddenPattern(serialized, pattern) === true) {
      throw new Error(`Metadata contains forbidden pattern: ${forbiddenPatternName(pattern)}`)
    }
  }
}

const assertTarballEntries = (tarballPath: string) => {
  const entries = runCapture(['tar', '-tzf', tarballPath])
    .split('\n')
    .filter((line) => line.length > 0)

  for (const entry of entries) {
    if (entry.startsWith('package/') === false) throw new Error(`Unexpected tarball prefix: ${entry}`)
    if (entry.includes('/src/') === true) throw new Error(`Source directory leaked into artifact: ${entry}`)
    if (entry.endsWith('.map') === true) throw new Error(`Sourcemap leaked into artifact: ${entry}`)
    if (entry.endsWith('.ts') === true && entry.endsWith('.d.ts') === false) {
      throw new Error(`TypeScript source leaked into artifact: ${entry}`)
    }
    if (entry.includes('/node_modules/') === true) throw new Error(`node_modules leaked into artifact: ${entry}`)
  }
}

const walkFiles = async (dir: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(dir)
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry)
      const fileStat = await stat(file)
      if (fileStat.isDirectory() === true) return walkFiles(file)
      return [file]
    }),
  )
  return files.flat()
}

const textLike = (file: string) =>
  /\.(?:json|js|css|html|txt|md|d\.ts|mjs|cjs)$/.test(file) || path.basename(file) === 'package.json'

const assertNoForbiddenText = async (tarballPath: string) => {
  const unpackDir = mkdtempSync(path.join(tmpdir(), 'livestore-devtools-public-audit-'))
  try {
    run(['tar', '-xzf', tarballPath, '-C', unpackDir])
    for (const file of await walkFiles(unpackDir)) {
      if (textLike(file) === false) continue
      const content = await readFile(file, 'utf8')
      for (const pattern of forbiddenPatterns) {
        if (containsForbiddenPattern(content, pattern) === true) {
          throw new Error(
            `Artifact text file contains forbidden pattern ${forbiddenPatternName(pattern)}: ${path.relative(unpackDir, file)}`,
          )
        }
      }
    }
  } finally {
    rmSync(unpackDir, { recursive: true, force: true })
  }
}

const verifyArtifact = async (flags: Map<string, string | true>) => {
  const { metadata, tarballPath, workDir } = await prepareInputs(flags)
  assertMetadata(metadata, tarballPath)
  assertTarballEntries(tarballPath)
  await assertNoForbiddenText(tarballPath)
  return { metadata, tarballPath, workDir }
}

const repackArtifact = async (flags: Map<string, string | true>) => {
  const version = readFlag(flags, 'version')
  if (version === undefined) throw new Error('--version is required')

  const { metadata, tarballPath, workDir } = await verifyArtifact(flags)
  const unpackDir = path.join(workDir, 'package-src')
  rmSync(unpackDir, { recursive: true, force: true })
  mkdirSync(unpackDir, { recursive: true })
  run(['tar', '-xzf', tarballPath, '-C', unpackDir])

  const packageDir = path.join(unpackDir, 'package')
  const packageJsonPath = path.join(packageDir, 'package.json')
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: string
    dependencies?: Record<string, string>
  }
  pkg.version = version
  pkg.dependencies = {
    ...pkg.dependencies,
    '@livestore/adapter-web': version,
    '@livestore/utils': version,
    vite: '*',
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  writeFileSync(
    path.join(packageDir, 'dist/release-metadata.json'),
    `${JSON.stringify({ schemaVersion: 1, devtoolsArtifact: metadata, livestoreVersion: version }, null, 2)}\n`,
  )

  const packedJson = runCapture(['npm', 'pack', '--json', '--pack-destination', workDir], {
    cwd: packageDir,
  })
  const packed = JSON.parse(packedJson) as ReadonlyArray<{ readonly filename: string }>
  const firstPacked = packed[0]
  if (firstPacked === undefined) throw new Error('npm pack did not produce a tarball')
  const repackedPath = path.join(workDir, `livestore-devtools-vite-${version}.tgz`)
  renameSync(path.join(workDir, firstPacked.filename), repackedPath)

  const publishTag = version.includes('-') === true ? 'snapshot' : 'latest'
  if (hasFlag(flags, 'dry-run') === true) {
    run(['npm', 'publish', '--dry-run', '--tag', publishTag, repackedPath], { cwd: workDir })
  }
  if (hasFlag(flags, 'publish') === true) {
    run(['npm', 'publish', '--tag', publishTag, '--access', 'public', repackedPath], { cwd: workDir })
  }

  console.log(JSON.stringify({ repackedPath, sha256: sha256(repackedPath) }, null, 2))
}

const main = async () => {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (command === 'help' || hasFlag(flags, 'help') === true) {
    console.log(usage)
    return
  }
  if (command === 'verify') {
    const result = await verifyArtifact(flags)
    console.log(JSON.stringify({ devtoolsBuildId: result.metadata.devtoolsBuildId, workDir: result.workDir }, null, 2))
    return
  }
  if (command === 'repack') {
    await repackArtifact(flags)
    return
  }
  throw new Error(`Unknown command: ${command}\n\n${usage}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
