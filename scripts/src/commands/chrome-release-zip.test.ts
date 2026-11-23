import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assertChromeZipVersion, chromeManifestFields, materializeChromeZipAsset } from './chrome-release-zip.ts'

describe('chromeManifestFields', () => {
  it.each([
    ['0.5.1', { name: 'LiveStore Devtools', version: '0.5.1' }],
    ['0.5.2-dev.3', { name: 'LiveStore Devtools (Dev Build)', version: '0.5.2.3', version_name: '0.5.2-dev.3' }],
    [
      '0.5.2-rc.65535',
      { name: 'LiveStore Devtools (Dev Build)', version: '0.5.2.65535', version_name: '0.5.2-rc.65535' },
    ],
    [
      '0.0.0-snapshot-abc123',
      { name: 'LiveStore Devtools (Dev Build)', version: '0.0.0.1', version_name: '0.0.0-snapshot-abc123' },
    ],
    ['0.5.1+build.7', { name: 'LiveStore Devtools', version: '0.5.1', version_name: '0.5.1+build.7' }],
  ])('maps %s to Chrome fields', (version, expected) => {
    expect(chromeManifestFields(version)).toEqual(expected)
  })

  it.each(['0.0.0', '0.5.65536', '0.5.2-dev.65536', '01.5.2', '../0.5.1', '0.5'])('rejects %s', (version) => {
    expect(() => chromeManifestFields(version)).toThrow()
  })
})

describe('Chrome release ZIP', () => {
  it.each(['LiveStore Devtools', 'LiveStore Devtools (Dev Build)'])('stamps release fields over %s', (name) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chrome-release-test-'))
    try {
      const root = 'livestore-devtools-chrome-0.4.0-dev.24'
      mkdirSync(path.join(dir, root, 'assets'), { recursive: true })
      const manifest = {
        manifest_version: 3,
        version: '0.4.0.24',
        version_name: 'stale-version',
        name,
        description: 'Devtools for LiveStore providing a real-time databrowser and other development tools.',
        icons: { '16': 'icon16.png', '32': 'icon32.png', '48': 'icon48.png', '128': 'icon128.png' },
        background: { service_worker: 'background-lsd-0.4.0-dev.24.js' },
      }
      writeFileSync(path.join(dir, root, 'manifest.json'), JSON.stringify(manifest))
      const payload = Buffer.from([0, 255, 17, 128, 10])
      writeFileSync(path.join(dir, root, 'assets', 'payload.bin'), payload)
      const source = path.join(dir, 'input.zip')
      execFileSync('zip', ['-qr', source, root], { cwd: dir })
      const original = readFileSync(source)
      for (const version of ['0.5.1', '0.5.2-dev.3', '0.5.2-rc.1']) {
        const asset = materializeChromeZipAsset(version, source, dir)
        const prefix = `livestore-devtools-chrome-${version}/`
        const entries = execFileSync('zipinfo', ['-1', asset], { encoding: 'utf8' }).trim().split('\n')
        expect(entries.sort()).toEqual(
          [prefix, `${prefix}assets/`, `${prefix}assets/payload.bin`, `${prefix}manifest.json`].sort(),
        )
        expect(execFileSync('unzip', ['-p', asset, `${prefix}assets/payload.bin`])).toEqual(payload)
        const { version_name: _staleVersionName, ...unchanged } = manifest
        expect(
          JSON.parse(execFileSync('unzip', ['-p', asset, `${prefix}manifest.json`], { encoding: 'utf8' })),
        ).toEqual({
          ...unchanged,
          ...chromeManifestFields(version),
        })
        mkdirSync(path.join(dir, prefix), { recursive: true })
        for (const invalidManifest of [
          manifest,
          {
            ...manifest,
            ...chromeManifestFields(version),
            name: version === '0.5.1' ? 'LiveStore Devtools (Dev Build)' : 'LiveStore Devtools',
          },
        ]) {
          writeFileSync(path.join(dir, prefix, 'manifest.json'), JSON.stringify(invalidManifest))
          execFileSync('zip', ['-q', asset, `${prefix}manifest.json`], { cwd: dir })
          expect(() => assertChromeZipVersion(asset, version)).toThrow(/does not match release/)
        }
      }
      expect(readFileSync(source)).toEqual(original)
      expect(() => materializeChromeZipAsset('0.5.1', source, dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
