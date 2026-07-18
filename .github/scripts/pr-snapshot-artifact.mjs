import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const shaPattern = /^[0-9a-f]{40}$/
const digestPattern = /^[0-9a-f]{64}$/
const lifecycleScripts = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepack',
  'prepare',
  'postpack',
  'prepublish',
  'publish',
  'postpublish',
])
const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies']
const maxArtifactBytes = 500 * 1024 * 1024
const maxTarballBytes = 100 * 1024 * 1024
const maxTarEntries = 100_000
const maxTarUncompressedBytes = 256 * 1024 * 1024

const fail = (message) => {
  throw new Error(message)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const parseOctal = (bytes, label) => {
  const value = Buffer.from(bytes).toString('ascii').replaceAll('\0', '').trim()
  if (/^[0-7]+$/.test(value) === false) fail(`Invalid tar ${label}: ${JSON.stringify(value)}`)
  return Number.parseInt(value, 8)
}

const tarEntries = (tarball) => {
  const archive = gunzipSync(tarball, { maxOutputLength: maxTarUncompressedBytes })
  const entries = []

  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0) === true) break

    const storedChecksum = parseOctal(header.subarray(148, 156), 'checksum')
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(0x20, 148, 156)
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0)
    if (storedChecksum !== actualChecksum) fail('Tar header checksum mismatch')

    const readString = (start, end) => {
      const decoded = Buffer.from(header.subarray(start, end)).toString('utf8')
      const nullIndex = decoded.indexOf(String.fromCharCode(0))
      return nullIndex === -1 ? decoded : decoded.slice(0, nullIndex)
    }
    const name = readString(0, 100)
    const prefix = readString(345, 500)
    const rawEntryPath = prefix === '' ? name : `${prefix}/${name}`
    const size = parseOctal(header.subarray(124, 136), 'size')
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    if (bodyEnd > archive.length) fail(`Truncated tar entry: ${rawEntryPath}`)

    const entryPath = type === '5' ? rawEntryPath.replace(/\/$/, '') : rawEntryPath
    if (entryPath.startsWith('package/') === false || path.posix.isAbsolute(entryPath) === true) {
      fail(`Tar entry is outside package/: ${entryPath}`)
    }
    if (entryPath.split('/').some((segment) => segment === '..' || segment === '') === true) {
      fail(`Unsafe tar entry path: ${entryPath}`)
    }
    if (entryPath === 'package/.npmrc') fail('Package tarball must not contain .npmrc')
    if (type !== '0' && type !== '5') fail(`Unsupported tar entry type ${JSON.stringify(type)}: ${entryPath}`)

    entries.push({ path: entryPath, type, body: archive.subarray(bodyStart, bodyEnd) })
    if (entries.length > maxTarEntries) fail(`Tarball exceeds ${maxTarEntries} entries`)
    offset = bodyStart + Math.ceil(size / 512) * 512
  }

  return entries
}

const parsePackage = (tarball) => {
  const manifests = tarEntries(tarball).filter((entry) => entry.path === 'package/package.json' && entry.type === '0')
  if (manifests.length !== 1) fail(`Expected exactly one package/package.json, found ${manifests.length}`)

  try {
    return JSON.parse(manifests[0].body.toString('utf8'))
  } catch (cause) {
    throw new Error('Invalid package/package.json', { cause })
  }
}

const readTopology = async (topologyPath) => {
  const bytes = await readFile(topologyPath)
  const topology = JSON.parse(bytes.toString('utf8'))
  const names = topology.publishablePackageNames
  if (Array.isArray(names) === false || names.length === 0 || names.some((name) => typeof name !== 'string') === true) {
    fail('Trusted release topology has no valid publishablePackageNames')
  }
  if (new Set(names).size !== names.length) fail('Trusted release topology contains duplicate package names')
  return { packageNames: [...names].toSorted((a, b) => a.localeCompare(b)), topologyDigest: sha256(bytes) }
}

export const snapshotTag = ({ prNumber, headSha }) => {
  const parsedPrNumber = positiveInteger(prNumber, 'PR number')
  if (shaPattern.test(headSha) === false) fail(`Invalid head SHA: ${headSha}`)
  return `pr-${parsedPrNumber}-${headSha}`
}

export const snapshotVersion = ({ prNumber, headSha }) => {
  const parsedPrNumber = positiveInteger(prNumber, 'PR number')
  if (shaPattern.test(headSha) === false) fail(`Invalid head SHA: ${headSha}`)
  return `0.0.0-snapshot-pr.${parsedPrNumber}.${headSha}`
}

export const successfulProducerAttempt = ({ jobs, jobName }) => {
  if (Array.isArray(jobs) === false) fail('Workflow jobs response is not an array')
  const matches = jobs.filter((job) => job?.name === jobName && job?.conclusion === 'success')
  if (matches.length === 0) fail(`Expected at least one successful ${jobName} job`)
  return Math.max(...matches.map((job) => positiveInteger(job.run_attempt, `${jobName} run attempt`)))
}

export const selectEligibleProducerRun = ({ runs, prNumber, headSha }) => {
  const parsedPrNumber = positiveInteger(prNumber, 'PR number')
  if (shaPattern.test(headSha) === false) fail(`Invalid head SHA: ${headSha}`)
  if (Array.isArray(runs) === false) fail('Workflow runs response is not an array')

  return (
    runs
      .filter(
        (run) =>
          run?.event === 'pull_request' &&
          run?.conclusion === 'success' &&
          run.pullRequests?.some(
            (pullRequest) => pullRequest?.number === parsedPrNumber && pullRequest?.headSha === headSha,
          ) === true &&
          Number.isSafeInteger(run.packAttempt) === true &&
          run.packAttempt > 0 &&
          run.artifacts?.some(
            (artifact) => artifact?.name === `pr-snapshot-${headSha}-${run.packAttempt}` && artifact?.expired === false,
          ) === true,
      )
      .toSorted((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null
  )
}

export const hasCurrentHeadApproval = ({ headSha, currentHeadSha, reviews }) => {
  if (shaPattern.test(headSha) === false || shaPattern.test(currentHeadSha) === false) return false
  if (headSha !== currentHeadSha || Array.isArray(reviews) === false) return false
  return reviews.some((review) => review?.state === 'APPROVED' && review?.commit_id === headSha)
}

export const isAuthorizedReviewState = ({ headSha, currentHeadSha, reviewDecision, reviews }) =>
  reviewDecision === 'APPROVED' && hasCurrentHeadApproval({ headSha, currentHeadSha, reviews })

const validatePackageManifest = ({ packageJson, expectedName, expectedVersion, packageNames }) => {
  if (packageJson.name !== expectedName)
    fail(`Package name mismatch: expected ${expectedName}, got ${packageJson.name}`)
  if (packageJson.version !== expectedVersion) {
    fail(`Package version mismatch for ${expectedName}: expected ${expectedVersion}, got ${packageJson.version}`)
  }

  for (const script of Object.keys(packageJson.scripts ?? {})) {
    if (lifecycleScripts.has(script) === true) fail(`Package ${expectedName} contains lifecycle script ${script}`)
  }

  if (packageJson.publishConfig !== undefined) {
    if (
      packageJson.publishConfig === null ||
      typeof packageJson.publishConfig !== 'object' ||
      Array.isArray(packageJson.publishConfig) === true
    ) {
      fail(`Package ${expectedName} has invalid publishConfig`)
    }
    assertExactKeys(packageJson.publishConfig, ['access'], `Package ${expectedName} publishConfig`)
    if (packageJson.publishConfig.access !== 'public') {
      fail(`Package ${expectedName} publishConfig must set access to public`)
    }
  }

  const packageSet = new Set(packageNames)
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(packageJson[field] ?? {})) {
      if (packageSet.has(name) === true && spec !== expectedVersion) {
        fail(`${expectedName} has non-exact ${field} entry ${name}@${spec}`)
      }
    }
  }
}

const assertExactKeys = (value, expected, label) => {
  const actual = Object.keys(value).toSorted((a, b) => a.localeCompare(b))
  const wanted = [...expected].toSorted((a, b) => a.localeCompare(b))
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys mismatch: expected ${wanted.join(', ')}, got ${actual.join(', ')}`)
  }
}

const positiveInteger = (value, label) => {
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) === false || parsed < 1) fail(`Invalid ${label}: ${value}`)
  return parsed
}

export const createManifest = async ({
  artifactDir,
  topologyPath,
  repository,
  prNumber,
  headSha,
  runId,
  runAttempt,
}) => {
  if (shaPattern.test(headSha) === false) fail(`Invalid head SHA: ${headSha}`)
  const parsedPrNumber = positiveInteger(prNumber, 'PR number')
  const version = snapshotVersion({ prNumber: parsedPrNumber, headSha })
  const { packageNames, topologyDigest } = await readTopology(topologyPath)
  const files = (await readdir(artifactDir))
    .filter((file) => file.endsWith('.tgz'))
    .toSorted((a, b) => a.localeCompare(b))
  if (files.length !== packageNames.length) {
    fail(`Tarball count mismatch: expected ${packageNames.length}, got ${files.length}`)
  }

  const packages = []
  let artifactBytes = 0
  for (const file of files) {
    if (path.basename(file) !== file || /^[a-zA-Z0-9._-]+\.tgz$/.test(file) === false)
      fail(`Unsafe tarball name: ${file}`)
    const fileStat = await lstat(path.join(artifactDir, file))
    artifactBytes += fileStat.size
    if (fileStat.isFile() === false || fileStat.size > maxTarballBytes || artifactBytes > maxArtifactBytes)
      fail(`Tarball is not a bounded regular file: ${file}`)
    const bytes = await readFile(path.join(artifactDir, file))
    const packageJson = parsePackage(bytes)
    if (typeof packageJson.name !== 'string') fail(`Tarball ${file} has no package name`)
    packages.push({ name: packageJson.name, file, sha256: sha256(bytes) })
  }
  packages.sort((a, b) => a.name.localeCompare(b.name))
  if (JSON.stringify(packages.map(({ name }) => name)) !== JSON.stringify(packageNames)) {
    fail('Tarball package set does not match release topology')
  }
  for (const entry of packages) {
    const bytes = await readFile(path.join(artifactDir, entry.file))
    validatePackageManifest({
      packageJson: parsePackage(bytes),
      expectedName: entry.name,
      expectedVersion: version,
      packageNames,
    })
  }

  const manifest = {
    schemaVersion: 1,
    repository,
    prNumber: parsedPrNumber,
    headSha,
    runId: positiveInteger(runId, 'run ID'),
    runAttempt: positiveInteger(runAttempt, 'run attempt'),
    version,
    topologySha256: topologyDigest,
    packages,
  }
  await writeFile(path.join(artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export const validateManifest = async ({
  artifactDir,
  topologyPath,
  repository,
  prNumber,
  headSha,
  runId,
  runAttempt,
  publishListPath,
}) => {
  if (shaPattern.test(headSha) === false) fail(`Invalid trusted head SHA: ${headSha}`)
  const manifestPath = path.join(artifactDir, 'manifest.json')
  const manifestStat = await lstat(manifestPath)
  if (manifestStat.isFile() === false || manifestStat.size > 1024 * 1024) fail('Manifest is not a bounded regular file')
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'repository',
      'prNumber',
      'headSha',
      'runId',
      'runAttempt',
      'version',
      'topologySha256',
      'packages',
    ],
    'Manifest',
  )

  const parsedPrNumber = positiveInteger(prNumber, 'PR number')
  const expectedVersion = snapshotVersion({ prNumber: parsedPrNumber, headSha })
  const expectedIdentity = {
    schemaVersion: 1,
    repository,
    prNumber: parsedPrNumber,
    headSha,
    runId: positiveInteger(runId, 'run ID'),
    runAttempt: positiveInteger(runAttempt, 'run attempt'),
    version: expectedVersion,
  }
  for (const [key, value] of Object.entries(expectedIdentity)) {
    if (manifest[key] !== value) fail(`Manifest ${key} mismatch: expected ${value}, got ${manifest[key]}`)
  }

  const { packageNames, topologyDigest } = await readTopology(topologyPath)
  if (manifest.topologySha256 !== topologyDigest) {
    fail(`Manifest topologySha256 mismatch: expected ${topologyDigest}, got ${manifest.topologySha256}`)
  }
  if (Array.isArray(manifest.packages) === false || manifest.packages.length !== packageNames.length) {
    fail(`Manifest package count mismatch: expected ${packageNames.length}`)
  }
  const actualFiles = (await readdir(artifactDir)).toSorted((a, b) => a.localeCompare(b))
  const expectedFiles = ['manifest.json', ...manifest.packages.map(({ file }) => file)].toSorted((a, b) =>
    a.localeCompare(b),
  )
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
    fail('Artifact contains missing or unexpected files')

  const seenNames = new Set()
  const seenFiles = new Set()
  let artifactBytes = 0
  for (const entry of manifest.packages) {
    assertExactKeys(entry, ['name', 'file', 'sha256'], 'Package entry')
    if (packageNames.includes(entry.name) === false || seenNames.has(entry.name) === true)
      fail(`Unexpected or duplicate package: ${entry.name}`)
    if (
      typeof entry.file !== 'string' ||
      path.basename(entry.file) !== entry.file ||
      /^[a-zA-Z0-9._-]+\.tgz$/.test(entry.file) === false ||
      seenFiles.has(entry.file) === true
    )
      fail(`Unsafe or duplicate tarball name: ${entry.file}`)
    if (digestPattern.test(entry.sha256) === false) fail(`Invalid digest for ${entry.name}`)
    seenNames.add(entry.name)
    seenFiles.add(entry.file)

    const tarballPath = path.join(artifactDir, entry.file)
    const fileStat = await lstat(tarballPath)
    artifactBytes += fileStat.size
    if (fileStat.isFile() === false || fileStat.size > maxTarballBytes || artifactBytes > maxArtifactBytes) {
      fail(`Tarball is not a bounded regular file: ${entry.file}`)
    }
    const bytes = await readFile(tarballPath)
    if (sha256(bytes) !== entry.sha256) fail(`Digest mismatch for ${entry.name}`)
    validatePackageManifest({
      packageJson: parsePackage(bytes),
      expectedName: entry.name,
      expectedVersion,
      packageNames,
    })
  }
  if (JSON.stringify([...seenNames].toSorted((a, b) => a.localeCompare(b))) !== JSON.stringify(packageNames))
    fail('Manifest package set does not match trusted topology')

  const publishEntries = manifest.packages
    .map(({ name, file }) => `${name}\t${file}`)
    .toSorted((a, b) => a.localeCompare(b))
  await writeFile(publishListPath, `${publishEntries.join('\n')}\n`)
  return {
    manifestDigest: sha256(manifestBytes),
    topologyDigest,
    version: expectedVersion,
    npmTag: snapshotTag({ prNumber, headSha }),
    packageCount: packageNames.length,
  }
}

const parseArgs = (args) => {
  const values = {}
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (match === null) fail(`Invalid argument: ${arg}`)
    values[match[1]] = match[2]
  }
  return values
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [mode, ...rawArgs] = process.argv.slice(2)
  const args = parseArgs(rawArgs)
  const common = {
    artifactDir: args['artifact-dir'],
    topologyPath: args['topology'],
    repository: args.repository,
    prNumber: args['pr-number'],
    headSha: args['head-sha'],
    runId: args['run-id'],
    runAttempt: args['run-attempt'],
  }
  const result =
    mode === 'create'
      ? await createManifest(common)
      : mode === 'validate'
        ? await validateManifest({ ...common, publishListPath: args['publish-list'] })
        : fail(`Unknown mode: ${mode}`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
