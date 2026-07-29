import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { sliceChangelogSection } from './release.ts'

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

describe('publish-release workflow', () => {
  const workflowPath = fileURLToPath(new URL('../../../.github/workflows/release.yml', import.meta.url))
  const workflow = readFileSync(workflowPath, 'utf8')

  it('creates or updates the GitHub Release only after npm publishing succeeds', () => {
    const npmPublishIndex = workflow.indexOf('      - name: Publish stable package release')
    const githubReleaseIndex = workflow.indexOf('      - name: Create or update GitHub Release')
    const devtoolsPublishIndex = workflow.indexOf('      - name: Publish DevTools artifact release')

    expect(npmPublishIndex).toBeGreaterThan(-1)
    expect(githubReleaseIndex).toBeGreaterThan(npmPublishIndex)
    expect(devtoolsPublishIndex).toBeGreaterThan(githubReleaseIndex)

    const nextStepIndex = workflow.indexOf('\n      - name:', githubReleaseIndex + 1)
    const githubReleaseStep = workflow.slice(githubReleaseIndex, nextStepIndex)

    expect(githubReleaseStep).toContain('::error::Missing committed GitHub Release notes: $notes_path')
    expect(githubReleaseStep).toContain('exit 1')
    expect(githubReleaseStep).toContain('gh release view')
    expect(githubReleaseStep).toContain('gh release edit')
    expect(githubReleaseStep).toContain('gh release create')
    expect(githubReleaseStep).toContain('--notes-file "$notes_path"')
    expect(githubReleaseStep).toContain('prerelease_args+=(--prerelease)')
    expect(githubReleaseStep).not.toMatch(/--notes(?:\s|")/)
    expect(githubReleaseStep).not.toContain('gh release upload')
  })
})
