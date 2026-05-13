import { describe, expect, it } from 'vitest'

import {
  assertCertifiedDevtoolsArtifactForLivestore,
  containsForbiddenPattern,
  type ArtifactManifest,
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

const manifest = (
  overrides: Partial<NonNullable<Extract<ArtifactManifest, { schemaVersion: 2 }>['certification']>> = {},
) =>
  ({
    schemaVersion: 2,
    artifact: {
      metadataUrl: 'release-metadata.json',
      tarballUrl: 'livestore-devtools-vite.tgz',
    },
    certification: {
      livestoreVersion: '0.4.0-dev.25',
      devtoolsBuildId: 'dt-test-build',
      devtoolsProtocolVersion: 1,
      status: 'passed',
      testSuite: 'devtools-direct-connect-e2e',
      scenarios: ['direct-url-connects-and-stays-connected'],
      ...overrides,
    },
  }) satisfies ArtifactManifest

describe('assertCertifiedDevtoolsArtifactForLivestore', () => {
  it('accepts an exact LiveStore-owned certification', () => {
    expect(
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest(),
        metadata,
        version: '0.4.0-dev.25',
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

  it('rejects legacy manifests that only describe the artifact pointer', () => {
    expect(() =>
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
      }),
    ).toThrow(/schemaVersion 2/)
  })

  it('rejects missing or non-passing certification', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: { schemaVersion: 2, artifact: { metadataUrl: 'release-metadata.json', tarballUrl: 'devtools.tgz' } },
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/certification entry/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest({ status: 'pending' }),
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/expected passed/)
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

  it('rejects certification for a different LiveStore release or DevTools build', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest({ livestoreVersion: '0.4.0-dev.24' }),
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/not release 0\.4\.0-dev\.25/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest({ devtoolsBuildId: 'dt-other-build' }),
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/does not match metadata build/)
  })

  it('rejects certification for a different protocol or incomplete test evidence', () => {
    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest({ devtoolsProtocolVersion: 2 }),
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/does not match metadata protocol/)

    expect(() =>
      assertCertifiedDevtoolsArtifactForLivestore({
        manifest: manifest({ scenarios: [] }),
        metadata,
        version: '0.4.0-dev.25',
      }),
    ).toThrow(/missing scenarios/)
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
