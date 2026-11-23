import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Release-facing fields mirror the producer's names and Chrome's numeric version constraints. */
export const chromeManifestFields = (version: string): { name: string; version: string; version_name?: string } => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (match === null) throw new Error(`Invalid release version: ${version}`)
  const components = match.slice(1, 4).map(Number)
  const prerelease = match[4]
  if (prerelease !== undefined) {
    const last = prerelease.split('.').at(-1) ?? ''
    // These channels carry Git hashes, not build counters, even when the hash is all digits.
    const hashBased = prerelease.startsWith('ci.release-validation.') || prerelease.startsWith('snapshot-')
    components.push(hashBased === false && /^\d+$/.test(last) === true ? Number(last) : 1)
  }
  if (components.some((part) => part > 65535) === true || components.every((part) => part === 0) === true) {
    throw new Error(`Release version cannot be represented by Chrome: ${version}`)
  }
  return {
    // overeng: devtools-chrome/src-assets/manifest.json and vite.config.js.
    name: `LiveStore Devtools${prerelease === undefined ? '' : ' (Dev Build)'}`,
    version: components.join('.'),
    ...(version === components.join('.') ? {} : { version_name: version }),
  }
}

/** Read the packaged manifest back, so stale release labels fail preparation. */
export const assertChromeZipVersion = (assetPath: string, version: string) => {
  const expected = chromeManifestFields(version)
  const manifest = JSON.parse(
    execFileSync('unzip', ['-p', assetPath, `livestore-devtools-chrome-${version}/manifest.json`], {
      encoding: 'utf8',
    }),
  ) as Record<string, unknown>
  if (
    manifest.version !== expected.version ||
    manifest.version_name !== expected.version_name ||
    manifest.name !== expected.name
  ) {
    throw new Error(`Chrome ZIP manifest does not match release ${version}`)
  }
}

/** Reuse the certified payload, changing only its directory prefix and release-facing manifest fields. */
export const materializeChromeZipAsset = (version: string, chromeZipPath: string, workDir: string) => {
  const stampedFields = chromeManifestFields(version)
  const entries = execFileSync('zipinfo', ['-1', chromeZipPath], { encoding: 'utf8' }).trim().split('\n')
  const root = entries[0]?.split('/')[0]
  if (
    root === undefined ||
    root === '' ||
    entries.some(
      (entry) => !entry.startsWith(`${root}/`) || entry.split('/').some((part) => part === '..' || part === '.'),
    ) === true ||
    entries.filter((entry) => entry === `${root}/manifest.json`).length !== 1
  ) {
    throw new Error('Chrome ZIP must contain one top-level directory and manifest.json')
  }
  const unpackDir = mkdtempSync(path.join(tmpdir(), 'livestore-chrome-release-'))
  const releaseRoot = `livestore-devtools-chrome-${version}`
  const assetPath = path.resolve(workDir, `${releaseRoot}.zip`)
  try {
    execFileSync('unzip', ['-q', path.resolve(chromeZipPath), '-d', unpackDir])
    const manifestPath = path.join(unpackDir, root, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.version_name
    Object.assign(manifest, stampedFields)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    renameSync(path.join(unpackDir, root), path.join(unpackDir, releaseRoot))
    // zip updates existing archives, so discard an earlier output to avoid stale entries.
    rmSync(assetPath, { force: true })
    execFileSync('zip', ['-q', '-r', assetPath, releaseRoot], { cwd: unpackDir })
    assertChromeZipVersion(assetPath, version)
    return assetPath
  } finally {
    rmSync(unpackDir, { recursive: true, force: true })
  }
}
