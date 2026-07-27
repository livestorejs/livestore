import { describe, expect, it } from 'vitest'

import { Effect, Schedule } from '@livestore/utils/effect'

import {
  registryVerification,
  sliceChangelogSection,
  type TRemoteRegistryState,
  verifyPackageOnRegistry,
} from './release.ts'

describe('verifyPackageOnRegistry', () => {
  const base = {
    pkg: '@livestore/livestore',
    version: '0.4.1',
    npmTag: 'latest',
    localIntegrity: undefined,
    // No delay between attempts so the retry policy is exercised without waiting.
    schedule: Schedule.recurs(5),
  }
  const converged: TRemoteRegistryState = { version: '0.4.1', integrity: 'sha512-x', distTag: '0.4.1' }
  const notPropagated: TRemoteRegistryState = { version: undefined, integrity: undefined, distTag: '0.4.0' }

  /** Returns each state in turn, then repeats the last one. */
  const readStates = (states: ReadonlyArray<TRemoteRegistryState>) => {
    let calls = 0
    const readState = Effect.sync(() => states[Math.min(calls++, states.length - 1)]!)
    return { readState, attempts: () => calls }
  }

  it('retries while the registry has not converged, then succeeds', async () => {
    const { readState, attempts } = readStates([notPropagated, notPropagated, converged])

    await Effect.runPromise(verifyPackageOnRegistry({ ...base, readState }))

    expect(attempts()).toBe(3)
  })

  it('fails once the retry budget is exhausted and the registry never converges', async () => {
    const { readState, attempts } = readStates([notPropagated])

    const exit = await Effect.runPromiseExit(verifyPackageOnRegistry({ ...base, readState }))

    expect(exit._tag).toBe('Failure')
    // Initial attempt + 5 retries.
    expect(attempts()).toBe(6)
  })

  // A published version is immutable on npm, so retrying a digest disagreement is pointless.
  it('fails immediately on a digest mismatch without retrying', async () => {
    const { readState, attempts } = readStates([{ version: '0.4.1', integrity: 'sha512-other', distTag: '0.4.1' }])

    const exit = await Effect.runPromiseExit(
      verifyPackageOnRegistry({ ...base, localIntegrity: 'sha512-ours', readState }),
    )

    expect(exit._tag).toBe('Failure')
    expect(attempts()).toBe(1)
  })
})

describe('registryVerification', () => {
  const base = { pkg: '@livestore/livestore', version: '0.4.1', npmTag: 'latest' }
  const localIntegrity = 'sha512-local'

  it('accepts a release the registry serves under the expected version and dist-tag', () => {
    expect(
      registryVerification({
        ...base,
        localIntegrity,
        remote: { version: '0.4.1', integrity: localIntegrity, distTag: '0.4.1' },
      }),
    ).toEqual({ _tag: 'ok' })
  })

  it('treats a not-yet-visible version as pending so propagation can be retried', () => {
    const result = registryVerification({
      ...base,
      localIntegrity,
      remote: { version: undefined, integrity: undefined, distTag: '0.4.0' },
    })
    expect(result._tag).toBe('pending')
  })

  // The failure #1289 tried to detect a day later: the version publishes fine but
  // `latest` keeps resolving to the previous release, so installs stay on the old one.
  it('flags a dist-tag still pointing at the previous release', () => {
    const result = registryVerification({
      ...base,
      localIntegrity,
      remote: { version: '0.4.1', integrity: localIntegrity, distTag: '0.4.0' },
    })
    expect(result).toEqual({
      _tag: 'pending',
      reason: '@livestore/livestore: dist-tag "latest" points at 0.4.0, expected 0.4.1',
    })
  })

  it('flags an absent dist-tag, which leaves the published version unreachable', () => {
    const result = registryVerification({
      ...base,
      localIntegrity,
      remote: { version: '0.4.1', integrity: localIntegrity, distTag: undefined },
    })
    expect(result._tag).toBe('pending')
    expect(result).toMatchObject({ reason: expect.stringContaining('is absent') })
  })

  // Immutable on npm, so retrying can never resolve it — must fail the release outright.
  it('reports a differing tarball digest as an unrecoverable mismatch', () => {
    const result = registryVerification({
      ...base,
      localIntegrity,
      remote: { version: '0.4.1', integrity: 'sha512-something-else', distTag: '0.4.1' },
    })
    expect(result._tag).toBe('mismatch')
  })

  it('skips the digest comparison for packages that were already published', () => {
    expect(
      registryVerification({
        ...base,
        localIntegrity: undefined,
        remote: { version: '0.4.1', integrity: 'sha512-whatever', distTag: '0.4.1' },
      }),
    ).toEqual({ _tag: 'ok' })
  })

  it('verifies the dist-tag named by the release plan rather than assuming latest', () => {
    expect(
      registryVerification({
        ...base,
        npmTag: 'dev',
        version: '0.5.0-dev.1',
        localIntegrity,
        remote: { version: '0.5.0-dev.1', integrity: localIntegrity, distTag: '0.5.0-dev.1' },
      }),
    ).toEqual({ _tag: 'ok' })
  })
})

describe('sliceChangelogSection', () => {
  it('extracts the verbatim block for a stable version with date heading', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 0.4.0 - 2026-06-02',
      '',
      '### Highlights',
      '',
      '- Cloudflare adapter',
      '- S2 sync backend',
      '',
      '## 0.3.0',
      '',
      '- old stuff',
      '',
    ].join('\n')

    expect(sliceChangelogSection(changelog, '0.4.0')).toMatchInlineSnapshot(`
      "### Highlights

      - Cloudflare adapter
      - S2 sync backend
      "
    `)
  })

  it('handles prerelease versions without conflating with the stable heading', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 0.4.0 - 2026-06-02',
      '',
      'stable notes',
      '',
      '## 0.4.0-dev.23',
      '',
      'dev notes',
      '',
    ].join('\n')

    expect(sliceChangelogSection(changelog, '0.4.0')).toBe('stable notes\n')
    expect(sliceChangelogSection(changelog, '0.4.0-dev.23')).toBe('dev notes\n')
  })

  it('throws a clear error when the heading is not found', () => {
    const changelog = '# Changelog\n\n## 0.3.0\n\n- old\n'
    expect(() => sliceChangelogSection(changelog, '0.4.0')).toThrow(/No changelog section found for version 0\.4\.0/)
  })

  it('throws when multiple matching headings exist (defensive)', () => {
    const changelog = ['# Changelog', '', '## 0.4.0', '', 'first', '', '## 0.4.0 - 2026-06-02', '', 'second', ''].join(
      '\n',
    )
    expect(() => sliceChangelogSection(changelog, '0.4.0')).toThrow(
      /Multiple changelog sections found for version 0\.4\.0/,
    )
  })

  it('reads up to the next ## heading even with deeper ### subheadings in between', () => {
    const changelog = [
      '## 0.4.0 - 2026-06-02',
      '',
      '### Highlights',
      '',
      '- a',
      '',
      '### Breaking Changes',
      '',
      '- b',
      '',
      '## 0.3.0',
      '',
      'old',
    ].join('\n')

    expect(sliceChangelogSection(changelog, '0.4.0')).toBe(
      ['### Highlights', '', '- a', '', '### Breaking Changes', '', '- b', ''].join('\n'),
    )
  })

  it('normalizes trailing whitespace to a single trailing newline', () => {
    const changelog = ['## 0.4.0', '', 'notes', '', '', '', '## 0.3.0', '', 'old'].join('\n')
    expect(sliceChangelogSection(changelog, '0.4.0')).toBe('notes\n')
  })

  it('extracts the last section in the file (no following ## heading)', () => {
    const changelog = ['## 0.4.0 - 2026-06-02', '', 'final notes', ''].join('\n')
    expect(sliceChangelogSection(changelog, '0.4.0')).toBe('final notes\n')
  })
})
