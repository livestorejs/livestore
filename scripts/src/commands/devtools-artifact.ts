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

import { supportedDevtoolsProtocolVersions } from '@livestore/common'

type CompatibleLivestore =
  | { readonly kind: 'range'; readonly range: string }
  | { readonly kind: 'snapshot'; readonly gitSha: string; readonly version: string }

export type ArtifactMetadata = {
  readonly schemaVersion: 1
  readonly artifactName: 'livestore-devtools-vite'
  readonly packageName: '@livestore/devtools-vite'
  readonly devtoolsVersion?: string
  readonly devtoolsBuildId: string
  readonly artifactVersion?: number
  readonly devtoolsProtocolVersion?: number
  readonly builtAt?: string
  readonly sourceRevision?: string
  readonly compatibleLivestore?: CompatibleLivestore
  readonly files: {
    readonly tarball: {
      readonly name: string
      readonly sha256: string
      readonly integrity: string
    }
    readonly chromeZip?: {
      readonly name: string
      readonly sha256: string
      readonly integrity: string
    }
  }
}

type ArtifactSource = {
  readonly metadataUrl: string
  readonly tarballUrl: string
  readonly sha256?: string
  readonly chromeZipUrl?: string
  readonly chromeZipSha256?: string
}

export type DevtoolsArtifactCertification = {
  readonly livestoreVersion: string
  readonly devtoolsBuildId: string
  readonly devtoolsProtocolVersion: number
  readonly status: 'pending' | 'passed' | 'failed'
  readonly testSuite: string
  readonly scenarios: ReadonlyArray<string>
  readonly evidence?: string
}

type DevtoolsArtifactEphemeralCertification = {
  readonly livestoreVersion: string
  readonly devtoolsBuildId: string
  readonly devtoolsProtocolVersion: number
  readonly status: 'ci-snapshot' | 'ci-release-validation' | 'ci-uncertified-repack'
  readonly testSuite: 'artifact-integrity-and-protocol-gate'
  readonly scenarios: ReadonlyArray<'ci-snapshot-repack' | 'ci-release-validation-repack' | 'ci-uncertified-repack'>
}

const requiredReleaseCertificationScenarios = [
  // Exact artifact certification installs the repacked @livestore/devtools-vite
  // package into the Node adapter fixture. Direct web transport liveness is
  // covered by the normal Playwright DevTools suite, but it is not evidence
  // that this selected npm artifact was installed and exercised.
  'node adapter session loads through Vite and stays connected past 35 seconds',
] as const

type ArtifactManifestV1 = {
  readonly schemaVersion: 1
  readonly artifact: ArtifactSource
}

type ArtifactManifestV2 = {
  readonly schemaVersion: 2
  readonly artifact: ArtifactSource
}

export type ArtifactManifest = ArtifactManifestV1 | ArtifactManifestV2

const usage = `Usage:
  bun scripts/src/commands/devtools-artifact.ts verify (--manifest <file> | --metadata <url-or-file> --tarball <url-or-file>)
  bun scripts/src/commands/devtools-artifact.ts certify --manifest <file> --version <version> --out <file> [--evidence <text>]
  bun scripts/src/commands/devtools-artifact.ts repack --manifest <file> --version <version> [--certification <file>|--allow-uncertified] [--dry-run|--publish]

Options:
  --manifest <file>        Checked-in public artifact manifest.
  --metadata <url-or-file>  Public release-metadata.json URL or local path
  --tarball <url-or-file>   Public artifact tarball URL or local path
  --chrome-zip <url-or-file> Public Chrome extension ZIP URL or local path
  --version <version>       LiveStore release-group package version for repack
  --certification <file>    Ephemeral release-candidate certification produced by the liveness gate
  --out-dir <dir>           Output directory for verified/repacked artifacts
  --out <file>              Certification output path for the certify command
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

const runCaptureOptional = (command: ReadonlyArray<string>, options: { readonly cwd?: string } = {}) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const integrity = (file: string) => `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`
const devtoolsProtocolVersionForArtifact = (metadata: ArtifactMetadata) => metadata.devtoolsProtocolVersion ?? 1

const normalizeArtifactMetadata = (metadata: ArtifactMetadata): ArtifactMetadata => ({
  ...metadata,
  devtoolsProtocolVersion: devtoolsProtocolVersionForArtifact(metadata),
})

const publishTagForVersion = (version: string) => {
  const prerelease = version.split('-')[1]
  if (prerelease === undefined) return 'latest'

  const prereleaseChannel = prerelease.split(/[.-]/)[0]
  if (prereleaseChannel === 'dev') return 'dev'
  if (prereleaseChannel === 'snapshot') return 'snapshot'

  return 'next'
}

const isSnapshotVersion = (version: string) => version.includes('-snapshot-')

const isCiReleaseValidationVersion = (version: string) => version.includes('-ci.release-validation.')

const packageVersionExists = (packageName: string, version: string) =>
  runCaptureOptional(['npm', 'view', `${packageName}@${version}`, 'version']) === version

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
  let manifest: ArtifactManifest | undefined
  let metadataSource = readFlag(flags, 'metadata')
  let tarballSource = readFlag(flags, 'tarball')
  let chromeZipSource = readFlag(flags, 'chrome-zip')
  let expectedTarballSha256: string | undefined
  let expectedChromeZipSha256: string | undefined

  if (manifestSource !== undefined) {
    if (metadataSource !== undefined || tarballSource !== undefined || chromeZipSource !== undefined) {
      throw new Error('--manifest cannot be combined with --metadata, --tarball, or --chrome-zip')
    }
    manifest = JSON.parse(readFileSync(path.resolve(manifestSource), 'utf8')) as ArtifactManifest
    if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
      throw new Error('Unsupported artifact manifest schemaVersion')
    }
    metadataSource = manifest.artifact.metadataUrl
    tarballSource = manifest.artifact.tarballUrl
    chromeZipSource = manifest.artifact.chromeZipUrl
    expectedTarballSha256 = manifest.artifact.sha256
    expectedChromeZipSha256 = manifest.artifact.chromeZipSha256
  }

  if (metadataSource === undefined) throw new Error('--metadata or --manifest is required')
  if (tarballSource === undefined) throw new Error('--tarball or --manifest is required')
  if (chromeZipSource !== undefined && expectedChromeZipSha256 === undefined) {
    throw new Error('Chrome ZIP URL requires an expected SHA-256')
  }

  const workDir = path.resolve(readFlag(flags, 'out-dir') ?? mkdtempSync(path.join(tmpdir(), 'livestore-devtools-')))
  const metadataPath = path.join(workDir, 'release-metadata.json')
  const tarballPath = path.join(workDir, 'livestore-devtools-vite.tgz')
  const chromeZipPath = chromeZipSource === undefined ? undefined : path.join(workDir, 'livestore-devtools-chrome.zip')
  await fetchToFile(metadataSource, metadataPath)
  await fetchToFile(tarballSource, tarballPath)
  if (chromeZipSource !== undefined && chromeZipPath !== undefined) {
    await fetchToFile(chromeZipSource, chromeZipPath)
  }
  if (expectedTarballSha256 !== undefined && sha256(tarballPath) !== expectedTarballSha256) {
    throw new Error('Manifest tarball SHA-256 mismatch')
  }
  if (
    chromeZipPath !== undefined &&
    expectedChromeZipSha256 !== undefined &&
    sha256(chromeZipPath) !== expectedChromeZipSha256
  ) {
    throw new Error('Manifest Chrome ZIP SHA-256 mismatch')
  }

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ArtifactMetadata
  return { workDir, metadata, metadataPath, tarballPath, chromeZipPath, manifest }
}

export const forbiddenPatterns: ReadonlyArray<string | RegExp> = [
  // Reject real host home paths without blocking Emscripten's browser-only
  // virtual filesystem defaults such as /home/web_user.
  /\/home\/(?!web_user(?:\/|["'`]|$))[A-Za-z0-9._-]+\//,
  '/Users/',
  'op://',
  /npm_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'BEGIN PRIVATE KEY',
]

const forbiddenPatternName = (pattern: string | RegExp) => (typeof pattern === 'string' ? pattern : pattern.source)

export const containsForbiddenPattern = (content: string, pattern: string | RegExp) =>
  typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)

const assertSupportedDevtoolsProtocol = (metadata: ArtifactMetadata) => {
  const protocolVersion = devtoolsProtocolVersionForArtifact(metadata)
  if (supportedDevtoolsProtocolVersions.includes(protocolVersion) === false) {
    throw new Error(
      `Unsupported DevTools protocol version ${protocolVersion}; supported versions: ${supportedDevtoolsProtocolVersions.join(', ')}`,
    )
  }
}

export const assertCertifiedDevtoolsArtifactForLivestore = ({
  manifest,
  metadata,
  version,
  certification,
  allowUncertified,
}: {
  readonly manifest: ArtifactManifest | undefined
  readonly metadata: ArtifactMetadata
  readonly version: string
  readonly certification?: DevtoolsArtifactCertification
  readonly allowUncertified?: boolean
}) => {
  const protocolVersion = devtoolsProtocolVersionForArtifact(metadata)

  if (manifest === undefined) {
    throw new Error(
      'DevTools repack requires --manifest so release-candidate certification is bound to the checked-in artifact pointer',
    )
  }
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) throw new Error('Unsupported artifact manifest')

  // Ephemeral CI versions cannot be pre-certified in a checked-in manifest:
  // snapshot versions are produced by the snapshot publisher, and
  // ci.release-validation versions are synthetic PR-only release-plan probes.
  // They still require the LiveStore-owned artifact pointer and pass through
  // artifact checksums, package-shape audit, secret scan, and protocol
  // validation; dev/stable release-channel packages below fail closed unless
  // LiveStore CI records an exact passed e2e certification for the release candidate.
  if (isSnapshotVersion(version) === true || isCiReleaseValidationVersion(version) === true) {
    return {
      livestoreVersion: version,
      devtoolsBuildId: metadata.devtoolsBuildId,
      devtoolsProtocolVersion: protocolVersion,
      status: isSnapshotVersion(version) === true ? 'ci-snapshot' : 'ci-release-validation',
      testSuite: 'artifact-integrity-and-protocol-gate',
      scenarios: isSnapshotVersion(version) === true ? ['ci-snapshot-repack'] : ['ci-release-validation-repack'],
    } satisfies DevtoolsArtifactEphemeralCertification
  }

  if (allowUncertified === true) {
    return {
      livestoreVersion: version,
      devtoolsBuildId: metadata.devtoolsBuildId,
      devtoolsProtocolVersion: protocolVersion,
      status: 'ci-uncertified-repack',
      testSuite: 'artifact-integrity-and-protocol-gate',
      scenarios: ['ci-uncertified-repack'],
    } satisfies DevtoolsArtifactEphemeralCertification
  }

  const releaseCertification = certification
  if (releaseCertification === undefined) {
    throw new Error(
      'DevTools repack requires release-candidate certification from release:devtools-artifact:certify-liveness',
    )
  }
  if (releaseCertification.status !== 'passed') {
    throw new Error(`DevTools artifact certification is ${releaseCertification.status}; expected passed`)
  }
  if (releaseCertification.livestoreVersion !== version) {
    throw new Error(
      `DevTools artifact is certified for LiveStore ${releaseCertification.livestoreVersion}, not release ${version}`,
    )
  }
  if (releaseCertification.devtoolsBuildId !== metadata.devtoolsBuildId) {
    throw new Error(
      `DevTools artifact certification build ${releaseCertification.devtoolsBuildId} does not match metadata build ${metadata.devtoolsBuildId}`,
    )
  }

  if (releaseCertification.devtoolsProtocolVersion !== protocolVersion) {
    throw new Error(
      `DevTools artifact certification protocol ${releaseCertification.devtoolsProtocolVersion} does not match metadata protocol ${protocolVersion}`,
    )
  }
  if (releaseCertification.testSuite.trim().length === 0)
    throw new Error('DevTools artifact certification is missing testSuite')
  if (releaseCertification.scenarios.length === 0)
    throw new Error('DevTools artifact certification is missing scenarios')
  for (const scenario of requiredReleaseCertificationScenarios) {
    if (releaseCertification.scenarios.includes(scenario) === false) {
      throw new Error(`DevTools artifact certification is missing required scenario: ${scenario}`)
    }
  }

  return releaseCertification
}

export const assertUncertifiedRepackMode = ({
  allowUncertified,
  publish,
}: {
  readonly allowUncertified: boolean
  readonly publish: boolean
}) => {
  if (allowUncertified === true && publish === true) {
    throw new Error('--allow-uncertified is only valid for dry-run repack; publish requires liveness certification')
  }
}

const assertMetadata = (metadata: ArtifactMetadata, tarballPath: string, chromeZipPath: string | undefined) => {
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported metadata schemaVersion')
  if (metadata.artifactName !== 'livestore-devtools-vite') throw new Error('Unexpected artifactName')
  if (metadata.packageName !== '@livestore/devtools-vite') throw new Error('Unexpected packageName')
  assertSupportedDevtoolsProtocol(metadata)
  if (metadata.files.tarball.sha256 !== sha256(tarballPath)) throw new Error('Tarball SHA-256 mismatch')
  if (metadata.files.tarball.integrity !== integrity(tarballPath)) throw new Error('Tarball integrity mismatch')
  if (metadata.files.chromeZip !== undefined) {
    if (chromeZipPath === undefined) throw new Error('Metadata declares Chrome ZIP but no Chrome ZIP was provided')
    if (metadata.files.chromeZip.sha256 !== sha256(chromeZipPath)) throw new Error('Chrome ZIP SHA-256 mismatch')
    if (metadata.files.chromeZip.integrity !== integrity(chromeZipPath)) {
      throw new Error('Chrome ZIP integrity mismatch')
    }
  }

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

const assertChromeZipEntries = (chromeZipPath: string) => {
  const entries = runCapture(['zipinfo', '-1', chromeZipPath])
    .split('\n')
    .filter((line) => line.length > 0)

  if (entries.some((entry) => entry.endsWith('/manifest.json')) === false) {
    throw new Error('Chrome ZIP is missing manifest.json')
  }

  for (const entry of entries) {
    if (entry.endsWith('.map') === true) throw new Error(`Sourcemap leaked into Chrome ZIP: ${entry}`)
    if (entry.endsWith('.ts') === true || entry.endsWith('.tsx') === true) {
      throw new Error(`TypeScript source leaked into Chrome ZIP: ${entry}`)
    }
    if (entry.includes('/src/') === true) throw new Error(`Source directory leaked into Chrome ZIP: ${entry}`)
    if (entry.includes('/node_modules/') === true) throw new Error(`node_modules leaked into Chrome ZIP: ${entry}`)
    if (entry.includes('/.vite/') === true) throw new Error(`Vite internal manifest leaked into Chrome ZIP: ${entry}`)
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

const assertNoForbiddenZipText = async (chromeZipPath: string) => {
  const unpackDir = mkdtempSync(path.join(tmpdir(), 'livestore-devtools-chrome-public-audit-'))
  try {
    run(['unzip', '-q', chromeZipPath, '-d', unpackDir])
    for (const file of await walkFiles(unpackDir)) {
      if (textLike(file) === false) continue
      const content = await readFile(file, 'utf8')
      for (const pattern of forbiddenPatterns) {
        if (containsForbiddenPattern(content, pattern) === true) {
          throw new Error(
            `Chrome ZIP text file contains forbidden pattern ${forbiddenPatternName(pattern)}: ${path.relative(unpackDir, file)}`,
          )
        }
      }
    }
  } finally {
    rmSync(unpackDir, { recursive: true, force: true })
  }
}

const verifyArtifact = async (flags: Map<string, string | true>) => {
  const { metadata, tarballPath, chromeZipPath, workDir, manifest } = await prepareInputs(flags)
  assertMetadata(metadata, tarballPath, chromeZipPath)
  assertTarballEntries(tarballPath)
  await assertNoForbiddenText(tarballPath)
  if (chromeZipPath !== undefined) {
    assertChromeZipEntries(chromeZipPath)
    await assertNoForbiddenZipText(chromeZipPath)
  }
  return { metadata, tarballPath, chromeZipPath, workDir, manifest }
}

const readCertification = (flags: Map<string, string | true>) => {
  const certificationPath = readFlag(flags, 'certification')
  if (certificationPath === undefined) return undefined
  return JSON.parse(readFileSync(path.resolve(certificationPath), 'utf8')) as DevtoolsArtifactCertification
}

const certifyArtifact = async (flags: Map<string, string | true>) => {
  const version = readFlag(flags, 'version')
  if (version === undefined) throw new Error('--version is required')
  const out = readFlag(flags, 'out')
  if (out === undefined) throw new Error('--out is required')

  const { metadata } = await verifyArtifact(flags)
  const protocolVersion = devtoolsProtocolVersionForArtifact(metadata)
  const evidence = readFlag(flags, 'evidence')
  const certification = {
    livestoreVersion: version,
    devtoolsBuildId: metadata.devtoolsBuildId,
    devtoolsProtocolVersion: protocolVersion,
    status: 'passed',
    testSuite: 'tests/integration/src/tests/playwright/devtools',
    scenarios: requiredReleaseCertificationScenarios,
    ...(evidence === undefined ? {} : { evidence }),
  } satisfies DevtoolsArtifactCertification

  mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  writeFileSync(path.resolve(out), `${JSON.stringify(certification, null, 2)}\n`)
  console.log(JSON.stringify({ certificationPath: path.resolve(out), certification }, null, 2))
}

const materializeChromeZipAsset = (version: string, chromeZipPath: string, workDir: string) => {
  const assetPath = path.join(workDir, `livestore-devtools-chrome-${version}.zip`)
  writeFileSync(assetPath, readFileSync(chromeZipPath))
  return assetPath
}

/**
 * Resolves the release notes file emitted by `mono release extract-release-notes`.
 * Returns `undefined` (with a warning) when the file is missing so DevTools-artifact
 * publishing remains unblocked. In that case the GitHub Release falls back to the
 * legacy `Release <version>` body.
 */
const resolveReleaseNotesPath = (version: string): string | undefined => {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? process.cwd()
  const candidate = path.resolve(workspaceRoot, 'release/release-notes.md')
  if (existsSync(candidate) === false) {
    console.warn(
      `[publishChromeZipReleaseAsset] release/release-notes.md not found for v${version}; ` +
        'falling back to "Release <version>" body. Run `mono release extract-release-notes` to populate it.',
    )
    return undefined
  }
  return candidate
}

const publishChromeZipReleaseAsset = (version: string, assetPath: string) => {
  const repo = process.env.GITHUB_REPOSITORY ?? 'livestorejs/livestore'
  const tag = `v${version}`
  const notesPath = resolveReleaseNotesPath(version)

  const releaseExists = spawnSync('gh', ['release', 'view', tag, '--repo', repo], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (releaseExists.status === 0) {
    /**
     * Refresh the body on reruns so a corrected `release/release-notes.md` actually lands
     * on the GitHub Release page. Without this, only the very first create call sets the
     * body, and later DevTools-artifact uploads silently leave a stale "Release <version>"
     * body in place — which is exactly the regression we hit on v0.4.0.
     */
    if (notesPath !== undefined) {
      run(['gh', 'release', 'edit', tag, '--repo', repo, '--notes-file', notesPath])
    }
  } else {
    const createArgs = ['gh', 'release', 'create', tag, '--repo', repo, '--title', tag]
    if (notesPath === undefined) {
      createArgs.push('--notes', `Release ${version}`)
    } else {
      createArgs.push('--notes-file', notesPath)
    }
    if (version.includes('-') === true) createArgs.push('--prerelease')
    run(createArgs)
  }

  run(['gh', 'release', 'upload', tag, assetPath, '--repo', repo, '--clobber'])
}

const repackArtifact = async (flags: Map<string, string | true>) => {
  const version = readFlag(flags, 'version')
  if (version === undefined) throw new Error('--version is required')
  assertUncertifiedRepackMode({
    allowUncertified: hasFlag(flags, 'allow-uncertified'),
    publish: hasFlag(flags, 'publish'),
  })

  const { metadata, tarballPath, chromeZipPath, workDir, manifest } = await verifyArtifact(flags)
  // The public DevTools artifact describes what was built; it does not decide which
  // LiveStore releases may ship it. LiveStore releases much more frequently than
  // DevTools artifacts, so release-channel repack/publish requires a CI proof
  // that binds the exact build id and protocol to the exact release candidate
  // after the release e2e suite has passed. This prevents stale artifacts with
  // broad compatibility metadata, such as "*", from being republished as current.
  const certification = readCertification(flags)
  const livestoreCertification = assertCertifiedDevtoolsArtifactForLivestore({
    manifest,
    metadata,
    version,
    ...(certification === undefined ? {} : { certification }),
    allowUncertified: hasFlag(flags, 'allow-uncertified'),
  })
  const unpackDir = path.join(workDir, 'package-src')
  rmSync(unpackDir, { recursive: true, force: true })
  mkdirSync(unpackDir, { recursive: true })
  run(['tar', '-xzf', tarballPath, '-C', unpackDir])

  const packageDir = path.join(unpackDir, 'package')
  const packageJsonPath = path.join(packageDir, 'package.json')
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: string
    dependencies?: Record<string, string>
    homepage?: string
    repository?: string | { readonly type?: string; readonly url?: string; readonly directory?: string }
    bugs?: { readonly url?: string }
  }
  pkg.version = version
  pkg.repository = {
    type: 'git',
    url: 'https://github.com/livestorejs/livestore',
    directory: 'packages/@livestore/devtools-vite',
  }
  pkg.homepage = 'https://github.com/livestorejs/livestore/tree/main/packages/@livestore/devtools-vite'
  pkg.bugs = { url: 'https://github.com/livestorejs/livestore/issues' }
  pkg.dependencies = {
    ...pkg.dependencies,
    '@livestore/adapter-web': version,
    '@livestore/utils': version,
    vite: '*',
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)

  writeFileSync(
    path.join(packageDir, 'dist/release-metadata.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        devtoolsArtifact: normalizeArtifactMetadata(metadata),
        livestoreVersion: version,
        livestoreCertification,
      },
      null,
      2,
    )}\n`,
  )

  const packedJson = runCapture(['npm', 'pack', '--json', '--pack-destination', workDir], {
    cwd: packageDir,
  })
  const packed = JSON.parse(packedJson) as ReadonlyArray<{ readonly filename: string }>
  const firstPacked = packed[0]
  if (firstPacked === undefined) throw new Error('npm pack did not produce a tarball')
  const repackedPath = path.join(workDir, `livestore-devtools-vite-${version}.tgz`)
  renameSync(path.join(workDir, firstPacked.filename), repackedPath)

  const publishTag = publishTagForVersion(version)
  if (hasFlag(flags, 'dry-run') === true) {
    // npm publish --dry-run still pre-checks the registry and errors with
    // "cannot publish over previously published versions" when the version
    // already exists. Treat existing-on-npm as stronger evidence that the
    // artifact is publishable than a dry-run could provide, so cert-liveness
    // reruns after a successful publish stay idempotent.
    if (packageVersionExists(metadata.packageName, version) === true) {
      console.warn(`${metadata.packageName}@${version} already published, skipping dry-run publish check`)
    } else {
      run(['npm', 'publish', '--dry-run', '--tag', publishTag, repackedPath], { cwd: workDir })
    }
  }
  if (hasFlag(flags, 'publish') === true) {
    const alreadyPublished = packageVersionExists(metadata.packageName, version)
    const publishArgs = ['npm', 'publish', '--tag', publishTag, '--access', 'public']
    if (process.env.GITHUB_ACTIONS === 'true') publishArgs.push('--provenance')
    publishArgs.push(repackedPath)
    if (alreadyPublished === true) {
      console.warn(`${metadata.packageName}@${version} already published, skipping npm publish`)
    } else {
      try {
        run(publishArgs, { cwd: workDir })
      } catch (error) {
        if (packageVersionExists(metadata.packageName, version) === false) {
          throw error
        }
        console.warn(`${metadata.packageName}@${version} became visible after npm publish failed; continuing`)
      }
    }
    if (chromeZipPath !== undefined) {
      const chromeZipAssetPath = materializeChromeZipAsset(version, chromeZipPath, workDir)
      if (isSnapshotVersion(version) === true) {
        console.log(`Snapshot Chrome zip prepared for workflow artifact upload: ${chromeZipAssetPath}`)
      } else {
        publishChromeZipReleaseAsset(version, chromeZipAssetPath)
      }
    }
  }

  console.log(JSON.stringify({ repackedPath, sha256: sha256(repackedPath), chromeZipPath }, null, 2))
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
  if (command === 'certify') {
    await certifyArtifact(flags)
    return
  }
  if (command === 'repack') {
    await repackArtifact(flags)
    return
  }
  throw new Error(`Unknown command: ${command}\n\n${usage}`)
}

if (import.meta.main === true) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
