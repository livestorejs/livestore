import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { sliceChangelogSection } from './release.ts'

const WorkflowStep = Schema.Struct({
  name: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  'continue-on-error': Schema.optional(Schema.Boolean),
})

const ReleaseWorkflow = Schema.Struct({
  jobs: Schema.Struct({
    'publish-release': Schema.Struct({
      steps: Schema.Array(WorkflowStep),
    }),
  }),
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

  it('throws when the matching section is empty or whitespace-only', () => {
    const empty = ['## 0.4.0', '', '## 0.3.0', '', 'old'].join('\n')
    const whitespaceOnly = ['## 0.4.0', '', '  ', '\t', '', '## 0.3.0', '', 'old'].join('\n')

    expect(() => sliceChangelogSection(empty, '0.4.0')).toThrow(
      /Changelog section for version 0\.4\.0 is empty/,
    )
    expect(() => sliceChangelogSection(whitespaceOnly, '0.4.0')).toThrow(
      /Changelog section for version 0\.4\.0 is empty/,
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
  const workflow = Schema.decodeUnknownSync(ReleaseWorkflow)(parse(readFileSync(workflowPath, 'utf8')))
  const steps = workflow.jobs['publish-release'].steps

  it('creates or updates the GitHub Release only after npm publishing succeeds', () => {
    const npmPublishIndex = steps.findIndex((step) => step.name === 'Publish stable package release')
    const githubReleaseIndex = steps.findIndex((step) => step.name === 'Create or update GitHub Release')
    const devtoolsPublishIndex = steps.findIndex((step) => step.name === 'Publish DevTools artifact release')

    expect(npmPublishIndex).toBeGreaterThan(-1)
    expect(githubReleaseIndex).toBeGreaterThan(npmPublishIndex)
    expect(devtoolsPublishIndex).toBeGreaterThan(githubReleaseIndex)

    const npmPublishStep = steps[npmPublishIndex]!
    const githubReleaseStep = steps[githubReleaseIndex]!
    const githubReleaseScript = githubReleaseStep.run!

    expect(npmPublishStep['continue-on-error']).not.toBe(true)
    expect(githubReleaseStep['continue-on-error']).not.toBe(true)
    expect(githubReleaseScript).toContain('::error::Missing or empty committed GitHub Release notes: $notes_path')
    expect(githubReleaseScript).toContain(`grep -q '[^[:space:]]' "$notes_path"`)
    expect(githubReleaseScript).toContain('exit 1')
    expect(githubReleaseScript).toContain('gh release view')
    expect(githubReleaseScript).toContain('gh release edit')
    expect(githubReleaseScript).toContain('gh release create')
    expect(githubReleaseScript).toContain('--target "$GITHUB_SHA"')
    expect(githubReleaseScript).toContain('--notes-file "$notes_path"')
    expect(githubReleaseScript).toContain('prerelease_args+=(--prerelease)')
    expect(githubReleaseScript).not.toMatch(/--notes(?:\s|")/)
    expect(githubReleaseScript).not.toContain('gh release upload')
  })
})
