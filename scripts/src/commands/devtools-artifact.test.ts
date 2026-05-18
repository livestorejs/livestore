import { describe, expect, it } from 'vitest'

import {
  assertCertifiedDevtoolsArtifactForLivestore,
  containsForbiddenPattern,
  type ArtifactManifest,
  type DevtoolsArtifactCertification,
  type ArtifactMetadata,
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

const certification = (overrides: Partial<DevtoolsArtifactCertification> = {}) => ({
  livestoreVersion: '0.4.0-dev.25',
  devtoolsBuildId: 'dt-test-build',
  devtoolsProtocolVersion: 1,
  status: 'passed' as const,
  testSuite: 'tests/integration/src/tests/playwright/devtools',
  scenarios: [
    'direct web session loads and stays connected past heartbeat window',
    'node adapter session loads through Vite and stays connected past 35 seconds',
  ],
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
    ).toThrow(/missing required scenario: node adapter session loads through Vite/)
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
