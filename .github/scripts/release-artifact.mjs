// Secretless release boundary: inspect packed bytes without extracting files or running package code.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const devtoolsName = '@livestore/devtools-vite'
const namePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const identifier = '(?:0|[1-9][0-9]*)'
const versionPattern = new RegExp(
  `^${identifier}\\.${identifier}\\.${identifier}(?:-(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
)
const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/
const tagPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const maxTarballBytes = 100 * 1024 * 1024
const fail = (message) => {
  throw new Error(message)
}
const matches = (pattern, value) => typeof value === 'string' && !/[\s\p{Cc}]/u.test(value) && pattern.test(value)
const exactKeys = (value, keys, label) => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    fail(`Invalid ${label} fields`)
  }
}

export const sha512 = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

// Keep identical to scripts/src/commands/devtools-artifact.ts publishTagForVersion.
export const publishTagForVersion = (version) => {
  const prerelease = version.split('-')[1]
  if (prerelease === undefined) return 'latest'
  const channel = prerelease.split(/[.-]/)[0]
  return channel === 'dev' ? 'dev' : channel === 'snapshot' ? 'snapshot' : 'next'
}

export const expectedPackageNames = (topology) => {
  const names = topology?.publishablePackageNames
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => !matches(namePattern, name))) {
    fail('Invalid topology publishablePackageNames')
  }
  if (new Set(names).size !== names.length || names.includes(devtoolsName)) fail('Duplicate topology package names')
  return [...names, devtoolsName].sort()
}

const validateExpected = ({ sourceSha, version, npmTag, packageNames }) => {
  if (!matches(/^[0-9a-f]{40}$/, sourceSha)) fail('Invalid source SHA')
  if (!matches(versionPattern, version)) fail('Invalid release version')
  if (!matches(tagPattern, npmTag)) fail('Invalid npm tag')
  if (
    !Array.isArray(packageNames) ||
    packageNames.length === 0 ||
    packageNames.some((name) => !matches(namePattern, name)) ||
    new Set(packageNames).size !== packageNames.length ||
    !packageNames.includes(devtoolsName)
  )
    fail('Invalid expected package names')
}

export const validateManifest = (manifest, expected) => {
  validateExpected(expected)
  exactKeys(manifest, ['schemaVersion', 'sourceSha', 'version', 'npmTag', 'packages'], 'manifest')
  if (manifest.schemaVersion !== 1) fail('Unsupported manifest schemaVersion')
  if (manifest.sourceSha !== expected.sourceSha) fail('Manifest source SHA mismatch')
  if (manifest.version !== expected.version) fail('Manifest version mismatch')
  if (manifest.npmTag !== expected.npmTag) fail('Manifest npm tag mismatch')
  if (!Array.isArray(manifest.packages)) fail('Manifest packages must be an array')
  const names = new Set()
  const filenames = new Set()
  for (const pkg of manifest.packages) {
    exactKeys(pkg, ['name', 'version', 'filename', 'integrity', 'tag'], 'package')
    if (!matches(namePattern, pkg.name)) fail('Invalid package name')
    if (!expected.packageNames.includes(pkg.name)) fail(`Unexpected package: ${pkg.name}`)
    if (names.has(pkg.name)) fail(`Duplicate package: ${pkg.name}`)
    if (pkg.version !== expected.version) fail(`Package version mismatch: ${pkg.name}`)
    if (!matches(filenamePattern, pkg.filename) || pkg.filename.includes('..')) fail('Unsafe tarball filename')
    if (filenames.has(pkg.filename)) fail(`Duplicate tarball filename: ${pkg.filename}`)
    if (
      !matches(/^sha512-[A-Za-z0-9+/]{86}==$/, pkg.integrity) ||
      `sha512-${Buffer.from(pkg.integrity.slice(7), 'base64').toString('base64')}` !== pkg.integrity
    )
      fail('Invalid sha512 integrity')
    const tag = pkg.name === devtoolsName ? publishTagForVersion(expected.version) : expected.npmTag
    if (pkg.tag !== tag) fail(`Package tag mismatch: ${pkg.name}`)
    names.add(pkg.name)
    filenames.add(pkg.filename)
  }
  for (const name of expected.packageNames) if (!names.has(name)) fail(`Missing package: ${name}`)
  return manifest
}

export const parsePackedPackage = (bytes) => {
  if (bytes.length > maxTarballBytes) fail('Tarball exceeds size limit')
  // tar reads stdin and writes only the selected member to stdout; no files are extracted.
  const entries = execFileSync('tar', ['-tzf', '-'], { input: bytes, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (entries.split('\n').filter((entry) => entry === 'package/package.json').length !== 1)
    fail('Expected exactly one package/package.json')
  const packed = JSON.parse(
    execFileSync('tar', ['-xOzf', '-', 'package/package.json'], {
      input: bytes,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }),
  )
  if (packed === undefined || packed === null || typeof packed !== 'object' || Array.isArray(packed))
    fail('Missing package/package.json')
  if (!matches(namePattern, packed.name)) fail('Invalid packed package name')
  if (!matches(versionPattern, packed.version)) fail('Invalid packed package version')
  if (packed.publishConfig !== undefined) {
    exactKeys(packed.publishConfig, ['access'], 'packed publishConfig')
    if (packed.publishConfig.access !== 'public') fail('Packed publishConfig must set access to public')
  }
  return { name: packed.name, version: packed.version }
}

export const createManifest = ({ tarballs, ...expected }) => {
  const manifest = {
    schemaVersion: 1,
    sourceSha: expected.sourceSha,
    version: expected.version,
    npmTag: expected.npmTag,
    packages: tarballs
      .map(({ filename, bytes }) => {
        const pkg = parsePackedPackage(bytes)
        return {
          ...pkg,
          filename,
          integrity: sha512(bytes),
          tag: pkg.name === devtoolsName ? publishTagForVersion(expected.version) : expected.npmTag,
        }
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }
  return validateManifest(manifest, expected)
}

export const validateArtifact = ({ manifest, tarballs, ...expected }) => {
  validateManifest(manifest, expected)
  const files = new Map()
  for (const tarball of tarballs) {
    if (files.has(tarball.filename)) fail(`Duplicate tarball: ${tarball.filename}`)
    files.set(tarball.filename, tarball.bytes)
  }
  if (files.size !== manifest.packages.length) fail('Unexpected or missing tarballs')
  for (const pkg of manifest.packages) {
    const bytes = files.get(pkg.filename)
    if (bytes === undefined) fail(`Missing tarball: ${pkg.filename}`)
    if (sha512(bytes) !== pkg.integrity) fail(`Tarball integrity mismatch: ${pkg.filename}`)
    const packed = parsePackedPackage(bytes)
    if (packed.name !== pkg.name || packed.version !== pkg.version)
      fail(`Packed package identity mismatch: ${pkg.filename}`)
  }
  return manifest
}

const readRegular = async (filename) => {
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Expected regular file, no symlinks: ${filename}`)
  return readFile(filename)
}

export const run = async (args) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'artifact-dir': { type: 'string' },
      'source-sha': { type: 'string' },
      version: { type: 'string' },
      'npm-tag': { type: 'string' },
      topology: { type: 'string' },
    },
  })
  if (
    positionals.length !== 1 ||
    !['create', 'validate'].includes(positionals[0]) ||
    Object.values(values).length !== 5 ||
    Object.values(values).some((value) => value === '')
  ) {
    fail(
      'Usage: release-artifact.mjs create|validate --artifact-dir DIR --source-sha SHA --version VERSION --npm-tag TAG --topology PATH',
    )
  }
  const artifactDir = values['artifact-dir']
  const stat = await lstat(artifactDir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Artifact directory must be a directory, not a symlink')
  const expected = {
    sourceSha: values['source-sha'],
    version: values.version,
    npmTag: values['npm-tag'],
    packageNames: expectedPackageNames(JSON.parse((await readRegular(values.topology)).toString('utf8'))),
  }
  const tarballs = []
  for (const filename of (await readdir(artifactDir)).sort()) {
    const fullPath = path.join(artifactDir, filename)
    const fileStat = await lstat(fullPath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) fail(`Artifact contains non-regular file: ${filename}`)
    if (
      !filename.endsWith('.tgz') &&
      !['manifest.json', 'release-notes.md', `livestore-devtools-chrome-${expected.version}.zip`].includes(filename)
    )
      fail(`Unexpected artifact file: ${filename}`)
    if (filename.endsWith('.tgz')) {
      if (!matches(filenamePattern, filename) || filename.includes('..')) fail('Unsafe tarball filename')
      if (fileStat.size > maxTarballBytes) fail('Tarball exceeds size limit')
      tarballs.push({ filename, bytes: await readRegular(fullPath) })
    }
  }
  if (positionals[0] === 'create') {
    const manifest = createManifest({ ...expected, tarballs })
    await writeFile(path.join(artifactDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  } else {
    const manifest = JSON.parse((await readRegular(path.join(artifactDir, 'manifest.json'))).toString('utf8'))
    validateArtifact({ ...expected, manifest, tarballs })
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
