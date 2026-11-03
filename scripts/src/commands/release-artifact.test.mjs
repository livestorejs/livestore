import { gzipSync } from 'node:zlib'

import { describe, expect, it } from '@effect/vitest'

import {
  createManifest,
  expectedPackageNames,
  parsePackedPackage,
  publishTagForVersion,
  sha512,
  validateArtifact,
  validateManifest,
} from '../../../.github/scripts/release-artifact.mjs'

// Build tar fixtures in memory; the inspector delegates listing/member reads to system tar.
const tarEntry = (name, body, type = '0') => {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write('0000644\0', 100, 8)
  header.write('0000000\0', 108, 8)
  header.write('0000000\0', 116, 8)
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12)
  header.write('00000000000\0', 136, 12)
  header.fill(32, 148, 156)
  header.write(type, 156, 1)
  header.write('ustar\0', 257, 6)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
}
const tarball = (name, version = '0.5.0', extraEntries = []) =>
  gzipSync(
    Buffer.concat([
      tarEntry('package/package.json', Buffer.from(JSON.stringify({ name, version }))),
      ...extraEntries,
      Buffer.alloc(1024),
    ]),
  )

const expected = {
  sourceSha: 'a'.repeat(40),
  version: '0.5.0',
  npmTag: 'latest',
  packageNames: ['@livestore/livestore', '@livestore/devtools-vite'],
}
const fixture = () => {
  const tarballs = [
    { filename: 'livestore-livestore-0.5.0.tgz', bytes: tarball('@livestore/livestore') },
    { filename: 'livestore-devtools-vite-0.5.0.tgz', bytes: tarball('@livestore/devtools-vite') },
  ]
  return { tarballs, manifest: createManifest({ ...expected, tarballs }) }
}

describe('release artifact manifest', () => {
  it('derives the exact expected package set from release topology plus DevTools', () => {
    expect(expectedPackageNames({ publishablePackageNames: ['@livestore/livestore'] })).toEqual([
      '@livestore/devtools-vite',
      '@livestore/livestore',
    ])
    for (const names of [
      [],
      ['../escape'],
      ['@livestore/livestore', '@livestore/livestore'],
      ['@livestore/devtools-vite'],
    ]) {
      expect(() => expectedPackageNames({ publishablePackageNames: names })).toThrow()
    }
  })

  it('creates and validates packed bytes against the exact package cohort', () => {
    const { manifest, tarballs } = fixture()
    expect(validateArtifact({ ...expected, manifest, tarballs })).toEqual(manifest)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.packages.map((pkg) => pkg.name)).toEqual([...expected.packageNames].sort())
  })

  it.each(['../escape', '@scope/../escape', '@Scope/name', '-flag', 'name\tvalue', 'name\n', 'name\u0085'])(
    'rejects malformed package name %j',
    (name) => {
      const { manifest } = fixture()
      manifest.packages[0].name = name
      expect(() => validateManifest(manifest, expected)).toThrow()
      expect(() => parsePackedPackage(tarball(name))).toThrow()
    },
  )

  it('rejects wrong source SHA, release version, npm tag, and package version', () => {
    const { manifest } = fixture()
    expect(() => validateManifest({ ...manifest, sourceSha: 'b'.repeat(40) }, expected)).toThrow(/source SHA/)
    expect(() => validateManifest({ ...manifest, version: '0.5.1' }, expected)).toThrow(/version/)
    expect(() => validateManifest({ ...manifest, npmTag: 'next' }, expected)).toThrow(/npm tag/)
    manifest.packages[0].version = '0.5.1'
    expect(() => validateManifest(manifest, expected)).toThrow(/version/)
  })

  it('rejects extra schema fields, unsupported schema versions, and invalid integrity', () => {
    const { manifest } = fixture()
    expect(() => validateManifest({ ...manifest, schemaVersion: 2 }, expected)).toThrow(/schemaVersion/)
    expect(() => validateManifest({ ...manifest, extra: true }, expected)).toThrow(/fields/)
    manifest.packages[0].integrity = 'sha256-deadbeef'
    expect(() => validateManifest(manifest, expected)).toThrow(/integrity/)
  })

  it.each([
    '../package.tgz',
    '/package.tgz',
    '-package.tgz',
    'dir/package.tgz',
    'dir\\package.tgz',
    'package.tgz\n',
    'package\tname.tgz',
  ])('rejects unsafe tarball filename %j', (filename) => {
    const { manifest } = fixture()
    manifest.packages[0].filename = filename
    expect(() => validateManifest(manifest, expected)).toThrow(/filename/)
  })

  it('rejects duplicate, missing, and unexpected packages and duplicate filenames', () => {
    const { manifest } = fixture()
    expect(() =>
      validateManifest({ ...manifest, packages: [...manifest.packages, manifest.packages[0]] }, expected),
    ).toThrow(/Duplicate/)
    expect(() => validateManifest({ ...manifest, packages: manifest.packages.slice(1) }, expected)).toThrow(/Missing/)
    const unexpected = structuredClone(manifest)
    unexpected.packages[0].name = '@livestore/unexpected'
    expect(() => validateManifest(unexpected, expected)).toThrow(/Unexpected/)
    manifest.packages[1].filename = manifest.packages[0].filename
    expect(() => validateManifest(manifest, expected)).toThrow(/Duplicate tarball filename/)
  })

  it('rejects tampering and extra, duplicate, or missing tarballs', () => {
    const { manifest, tarballs } = fixture()
    const tampered = [{ ...tarballs[0], bytes: Buffer.concat([tarballs[0].bytes, Buffer.from('tamper')]) }, tarballs[1]]
    expect(() => validateArtifact({ ...expected, manifest, tarballs: tampered })).toThrow(/integrity/)
    expect(() =>
      validateArtifact({ ...expected, manifest, tarballs: [...tarballs, { ...tarballs[0], filename: 'extra.tgz' }] }),
    ).toThrow(/tarballs/)
    expect(() => validateArtifact({ ...expected, manifest, tarballs: [...tarballs, tarballs[0]] })).toThrow(
      /Duplicate tarball/,
    )
    expect(() => validateArtifact({ ...expected, manifest, tarballs: tarballs.slice(1) })).toThrow(/tarballs/)
  })

  it.each([
    ['@livestore/unexpected', '0.5.0'],
    ['@livestore/livestore', '0.5.1'],
  ])('checks packed identity even with matching digest: %s@%s', (name, version) => {
    const { manifest, tarballs } = fixture()
    const replacement = tarball(name, version)
    tarballs[0].bytes = replacement
    manifest.packages.find((pkg) => pkg.name === '@livestore/livestore').integrity = sha512(replacement)
    expect(() => validateArtifact({ ...expected, manifest, tarballs })).toThrow(/identity/)
  })

  it.each([
    ['0.5.0', 'latest'],
    ['0.5.0-dev.1', 'dev'],
    ['0.0.0-snapshot-abc', 'snapshot'],
    ['0.5.0-beta.1', 'next'],
  ])('preserves DevTools tag derivation for %s', (version, tag) => {
    expect(publishTagForVersion(version)).toBe(tag)
    const tarballs = expected.packageNames.map((name, index) => ({
      filename: `pkg-${index}.tgz`,
      bytes: tarball(name, version),
    }))
    const manifest = createManifest({ ...expected, version, npmTag: 'snapshot', tarballs })
    expect(manifest.packages.find((pkg) => pkg.name === '@livestore/devtools-vite').tag).toBe(tag)
    expect(manifest.packages.find((pkg) => pkg.name === '@livestore/livestore').tag).toBe('snapshot')
    manifest.packages[0].tag = 'wrong'
    expect(() => validateManifest(manifest, { ...expected, version, npmTag: 'snapshot' })).toThrow(/tag/)
  })

  it.each([
    { sourceSha: 'a'.repeat(40) + '\n' },
    { sourceSha: 'short' },
    { version: '0.5.0\n' },
    { version: '01.5.0' },
    { npmTag: 'latest\n' },
    { npmTag: 'next\tvalue' },
  ])('rejects unsafe expected inputs %j', (override) => {
    const { tarballs } = fixture()
    expect(() => createManifest({ ...expected, ...override, tarballs })).toThrow()
  })
})

describe('packed package inspection', () => {
  it('allows only absent or public-access-only packed publishConfig', () => {
    for (const publishConfig of [
      undefined,
      { access: 'public' },
      { access: 'public', registry: 'https://attacker.example' },
      { access: 'public', tag: 'attacker' },
      { access: 'public', ignoreScripts: false },
      { access: 'public', provenance: false },
      { access: 'restricted' },
      {},
      null,
      [],
    ]) {
      const bytes = gzipSync(
        Buffer.concat([
          tarEntry(
            'package/package.json',
            Buffer.from(
              JSON.stringify({
                name: '@livestore/livestore',
                version: '0.5.0',
                publishConfig,
              }),
            ),
          ),
          Buffer.alloc(1024),
        ]),
      )
      if (publishConfig === undefined || JSON.stringify(publishConfig) === '{"access":"public"}') {
        expect(parsePackedPackage(bytes)).toEqual({ name: '@livestore/livestore', version: '0.5.0' })
      } else {
        expect(() => parsePackedPackage(bytes)).toThrow(/publishConfig/)
      }
    }
  })

  it('rejects duplicate or missing package manifests', () => {
    const duplicate = tarEntry('package/package.json', Buffer.from('{}'))
    expect(() => parsePackedPackage(tarball('@livestore/livestore', '0.5.0', [duplicate]))).toThrow(/exactly one/)
    expect(() => parsePackedPackage(gzipSync(Buffer.alloc(1024)))).toThrow(/exactly one/)
  })

  it.each([
    'package/./package.json',
    './package/package.json',
    'package//package.json',
    'package/sub/../package.json',
    '/package/package.json',
    'package\\package.json',
    'outside/package.json',
  ])('rejects non-canonical archive entry %j alongside the real manifest', (alias) => {
    expect(() =>
      parsePackedPackage(tarball('@livestore/livestore', '0.5.0', [tarEntry(alias, Buffer.from('{}'))])),
    ).toThrow(/Non-canonical/)
  })

  it('bounds decompression before invoking tar', () => {
    const bytes = tarball('@livestore/livestore')
    expect(() => parsePackedPackage(bytes, 512)).toThrow(/larger than|size|length/i)
    expect(parsePackedPackage(bytes, 4096)).toEqual({ name: '@livestore/livestore', version: '0.5.0' })
  })
})
