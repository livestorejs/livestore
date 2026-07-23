import { describe, expect, it } from 'vitest'

import {
  type ArtifactManifest,
  type ArtifactMetadata,
  assertCertifiedDevtoolsArtifactForLivestore,
  assertMonotonicArtifactTransition,
  assertOfficialArtifactRelease,
  assertUncertifiedRepackMode,
  containsForbiddenPattern,
  type DevtoolsArtifactCertification,
  forbiddenPatterns,
} from './devtools-artifact.ts'

const metadata: ArtifactMetadata = {
  schemaVersion: 1,
  artifactName: 'livestore-devtools-vite',
  packageName: '@livestore/devtools-vite',
  devtoolsBuildId: 'dt-test-build',
  devtoolsProtocolVersion: 1,
  files: {
    tarball: {
      name: 'livestore-devtools-vite.tgz',
      sha256: 'tarball-sha',
      integrity: 'tarball-integrity',
    },
  },
}

const manifest = () =>
  ({
    schemaVersion: 2,
    artifact: {
      metadataUrl: 'release-metadata.json',
      tarballUrl: 'livestore-devtools-vite.tgz',
    },
  }) satisfies ArtifactManifest

const officialMetadata = (overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({
  ...metadata,
  devtoolsBuildId: 'dt-20260718-51c22feb',
  builtAt: '2026-07-18T09:00:00.000Z',
  sourceRevision: 'bf243c179c801511e2c0f9c9987d107b57484417',
  files: {
    tarball: {
      name: 'livestore-devtools-vite.tgz',
      sha256: 'a'.repeat(64),
      integrity: 'sha512-tarball',
    },
    chromeZip: {
      name: 'livestore-devtools-chrome.zip',
      sha256: 'b'.repeat(64),
      integrity: 'sha512-chrome',
    },
  },
  ...overrides,
})

const officialManifest = (buildId = 'dt-20260718-51c22feb'): ArtifactManifest => ({
  schemaVersion: 2,
  artifact: {
    metadataUrl: `https://github.com/livestorejs/livestore-devtools-artifacts/releases/download/devtools-artifact-${buildId}/release-metadata.json`,
    tarballUrl: `https://github.com/livestorejs/livestore-devtools-artifacts/releases/download/devtools-artifact-${buildId}/livestore-devtools-vite.tgz`,
    sha256: 'a'.repeat(64),
    chromeZipUrl: `https://github.com/livestorejs/livestore-devtools-artifacts/releases/download/devtools-artifact-${buildId}/livestore-devtools-chrome.zip`,
    chromeZipSha256: 'b'.repeat(64),
  },
})

const certification = (overrides: Partial<DevtoolsArtifactCertification> = {}) => ({
  livestoreVersion: '0.4.0-dev.25',
  devtoolsBuildId: 'dt-test-build',
  devtoolsProtocolVersion: 1,
  status: 'passed' as const,
  testSuite: 'tests/integration/src/tests/playwright/devtools',
  scenarios: ['@livestore/devtools-vite artifact serves DevTools through Vite'],
  ...overrides,
})

describe('assertCertifiedDevtoolsArtifactForLivestore', () => {
  it('accepts an exact release-candidate certification', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification(),
      }),
    ).toMatchObject({ livestoreVersion: '0.4.0-dev.25', devtoolsBuildId: 'dt-test-build' })
  })

  it('rejects direct repack inputs without a checked-in certification manifest', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: undefined,
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/requires --manifest/)
  })

  it('rejects missing or non-passing release-candidate certification', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: { schemaVersion: 2, artifact: { metadataUrl: 'release-metadata.json', tarballUrl: 'devtools.tgz' } },
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/release-candidate certification/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({ status: 'pending' }),
      }),
    ).toThrow(/expected passed/)
  })

  it('allows an artifact-only manifest when release-candidate certification is provided', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: {
          schemaVersion: 1,
          artifact: {
            metadataUrl: 'release-metadata.json',
            tarballUrl: 'livestore-devtools-vite.tgz',
          },
        },
        metadata,
        version: '0.4.0-dev.25',
        certification: certification(),
      }),
    ).toMatchObject({ livestoreVersion: '0.4.0-dev.25', status: 'passed' })
  })

  it('allows CI snapshot repack through the artifact and protocol gates without release certification', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: { schemaVersion: 2, artifact: { metadataUrl: 'release-metadata.json', tarballUrl: 'devtools.tgz' } },
        metadata,
        version: '0.0.0-snapshot-abc123',
      }),
    ).toMatchObject({
      livestoreVersion: '0.0.0-snapshot-abc123',
      status: 'ci-snapshot',
      testSuite: 'artifact-integrity-and-protocol-gate',
    })
  })

  it('allows synthetic CI release validation repack without exact release certification', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.0.0-ci.release-validation.abc123',
      }),
    ).toMatchObject({
      livestoreVersion: '0.0.0-ci.release-validation.abc123',
      status: 'ci-release-validation',
      testSuite: 'artifact-integrity-and-protocol-gate',
      scenarios: ['ci-release-validation-repack'],
    })
  })

  it('allows an explicit uncertified dry-run repack before liveness certification', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        allowUncertified: true,
      }),
    ).toMatchObject({
      livestoreVersion: '0.4.0-dev.25',
      status: 'ci-uncertified-repack',
      scenarios: ['ci-uncertified-repack'],
    })
  })

  it('rejects an uncertified publish repack before liveness certification', () => {
    expect(() => assertUncertifiedRepackMode({ allowUncertified: true, publish: true })).toThrow(
      /allow-uncertified.*dry-run/,
    )
    expect(() => assertUncertifiedRepackMode({ allowUncertified: true, publish: false })).not.toThrow()
  })

  it('rejects certification for a different LiveStore release or DevTools build', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({ livestoreVersion: '0.4.0-dev.24' }),
      }),
    ).toThrow(/not release 0\.4\.0-dev\.25/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({ devtoolsBuildId: 'dt-other-build' }),
      }),
    ).toThrow(/does not match metadata build/)
  })

  it('rejects certification for a different protocol or incomplete test evidence', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({ devtoolsProtocolVersion: 2 }),
      }),
    ).toThrow(/does not match metadata protocol/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({ scenarios: [] }),
      }),
    ).toThrow(/missing scenarios/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
        certification: certification({
          scenarios: ['direct web session loads and stays connected past heartbeat window'],
        }),
      }),
    ).toThrow(/missing required scenario: @livestore\/devtools-vite artifact serves DevTools through Vite/)
  })
})

describe('artifact forbidden text patterns', () => {
  const containsForbiddenText = (content: string) =>
    forbiddenPatterns.some((pattern) => containsForbiddenPattern(content, pattern))

  it('allows Emscripten virtual home paths but rejects host home paths', () => {
    expect(containsForbiddenText('HOME: "/home/web_user"')).toBe(false)
    expect(containsForbiddenText('source: "/home/alice/project/src/file.ts"')).toBe(true)
    expect(containsForbiddenText('source: "/Users/alice/project/src/file.ts"')).toBe(true)
  })
})

describe('official artifact release policy', () => {
  it('accepts canonical official release assets with matching metadata', () => {
    expect(() =>
      assertOfficialArtifactRelease({ manifest: officialManifest(), metadata: officialMetadata() }),
    ).not.toThrow()
  })

  it.each([
    [
      'foreign repository',
      /livestorejs\/livestore-devtools-artifacts/,
      'livestorejs/other-artifacts',
      /must come from livestorejs\/livestore-devtools-artifacts release assets/,
    ],
    [
      'mixed release tag',
      /devtools-artifact-dt-20260718-51c22feb/,
      'devtools-artifact-dt-20260718-deadbeef',
      /does not match/,
    ],
    ['non-canonical filename', /livestore-devtools-vite\.tgz$/, 'devtools.tgz', /does not match/],
  ])('rejects a %s', (_case, pattern, replacement, expected) => {
    const canonical = officialManifest()
    const manifestWithReplacement: ArtifactManifest = {
      ...canonical,
      artifact: {
        ...canonical.artifact,
        tarballUrl: canonical.artifact.tarballUrl.replace(pattern, replacement),
      },
    }
    expect(() =>
      assertOfficialArtifactRelease({ manifest: manifestWithReplacement, metadata: officialMetadata() }),
    ).toThrow(expected)
  })

  it('rejects malformed, mismatched, or incomplete digests', () => {
    const canonical = officialManifest()
    const { chromeZipUrl: _chromeZipUrl, ...withoutChromeUrl } = canonical.artifact
    expect(() =>
      assertOfficialArtifactRelease({
        manifest: { ...canonical, artifact: { ...canonical.artifact, sha256: 'A'.repeat(64) } },
        metadata: officialMetadata(),
      }),
    ).toThrow(/lowercase SHA-256/)
    expect(() =>
      assertOfficialArtifactRelease({
        manifest: { ...canonical, artifact: { ...canonical.artifact, sha256: 'c'.repeat(64) } },
        metadata: officialMetadata(),
      }),
    ).toThrow(/does not match release metadata/)
    expect(() =>
      assertOfficialArtifactRelease({
        manifest: { ...canonical, artifact: withoutChromeUrl },
        metadata: officialMetadata(),
      }),
    ).toThrow(/requires matching Chrome ZIP/)
  })

  it.each([
    [{ devtoolsBuildId: 'latest' }, /build id/],
    [{ sourceRevision: 'bf243c1' }, /full source revision/],
    [{ builtAt: 'not-a-date' }, /valid builtAt/],
  ])('rejects invalid identity metadata %#', (overrides, expected) => {
    expect(() =>
      assertOfficialArtifactRelease({ manifest: officialManifest(), metadata: officialMetadata(overrides) }),
    ).toThrow(expected)
  })
})

describe('artifact transition policy', () => {
  it('accepts a newer, distinct artifact build', () => {
    expect(() =>
      assertMonotonicArtifactTransition({
        previous: officialMetadata(),
        next: officialMetadata({ devtoolsBuildId: 'dt-20260719-deadbeef', builtAt: '2026-07-19T09:00:00.000Z' }),
      }),
    ).not.toThrow()
  })

  it.each([
    [
      'older timestamp',
      { devtoolsBuildId: 'dt-20260717-deadbeef', builtAt: '2026-07-17T09:00:00.000Z' },
      /move forward/,
    ],
    [
      'equal timestamp',
      { devtoolsBuildId: 'dt-20260719-deadbeef', builtAt: '2026-07-18T09:00:00.000Z' },
      /move forward/,
    ],
    ['same build', { devtoolsBuildId: 'dt-20260718-51c22feb', builtAt: '2026-07-19T09:00:00.000Z' }, /new build/],
  ])('rejects a %s', (_case, overrides, expected) => {
    expect(() =>
      assertMonotonicArtifactTransition({ previous: officialMetadata(), next: officialMetadata(overrides) }),
    ).toThrow(expected)
  })
})
