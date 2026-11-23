import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assertChromeZipVersion, chromeManifestVersion, materializeChromeZipAsset } from './chrome-release-zip.ts'

describe('chromeManifestVersion', () => {
  it.each([
    ['0.5.1', { version: '0.5.1' }],
    ['0.5.2-dev.3', { version: '0.5.2.3', version_name: '0.5.2-dev.3' }],
    ['0.5.2-rc.65535', { version: '0.5.2.65535', version_name: '0.5.2-rc.65535' }],
    ['0.0.0-snapshot-abc123', { version: '0.0.0.1', version_name: '0.0.0-snapshot-abc123' }],
    ['0.5.1+build.7', { version: '0.5.1', version_name: '0.5.1+build.7' }],
  ])('maps %s to Chrome fields', (version, expected) => {
    expect(chromeManifestVersion(version)).toEqual(expected)
  })

  it.each(['0.0.0', '0.5.65536', '0.5.2-dev.65536', '01.5.2', '../0.5.1', '0.5'])('rejects %s', (version) => {
    expect(() => chromeManifestVersion(version)).toThrow()
  })
})

describe('Chrome release ZIP', () => {
  it('rewrites the root and version fields without changing the name or payload bytes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chrome-release-test-'))
    try {
      const root = 'livestore-devtools-chrome-0.4.0-dev.24'
      mkdirSync(path.join(dir, root, 'assets'), { recursive: true })
      const manifest = {
        manifest_version: 3,
        version: '0.4.0.24',
        version_name: 'stale-version',
        name: 'LiveStore Devtools (Dev Build)',
        background: { service_worker: 'background.js' },
      }
      writeFileSync(path.join(dir, root, 'manifest.json'), JSON.stringify(manifest))
      const payload = Buffer.from([0, 255, 17, 128, 10])
      writeFileSync(path.join(dir, root, 'assets', 'payload.bin'), payload)
      const source = path.join(dir, 'input.zip')
      execFileSync('zip', ['-qr', source, root], { cwd: dir })
      const original = readFileSync(source)
      for (const version of ['0.5.1', '0.5.2-dev.3']) {
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
          ...chromeManifestVersion(version),
        })
        mkdirSync(path.join(dir, prefix), { recursive: true })
        writeFileSync(path.join(dir, prefix, 'manifest.json'), JSON.stringify(manifest))
        execFileSync('zip', ['-q', asset, `${prefix}manifest.json`], { cwd: dir })
        expect(() => assertChromeZipVersion(asset, version)).toThrow(/does not match release/)
      }
      expect(readFileSync(source)).toEqual(original)
      expect(() => materializeChromeZipAsset('0.5.1', source, dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
