import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8'))
const publish = workflow.jobs['publish-snapshot-version'].steps.find(
  (step: { name?: string }) => step.name === 'Verify bytes and publish without build code',
).run

// Execute the shipped shell with a fake registry and clock, never a real npm upload.
const run = (
  scenario: {
    existing?: boolean
    wrongIntegrity?: boolean
    publishFailure?: boolean
    apiFailure?: boolean
    artifactCount?: number
    transientUntil?: number
    visibleAfter?: number
    secondVisibleAfter?: number
    tagAfter?: number
  } = {},
  shell = publish,
) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-publish-'))
  const digest = (bytes: string) => createHash('sha512').update(bytes).digest('base64')
  const packages = ['first', 'second'].map((name) => ({
    name,
    version: '0.5.0',
    filename: `${name}.tgz`,
    integrity: `sha512-${digest(name)}`,
    tag: 'snapshot',
  }))
  try {
    for (const pkg of packages) writeFileSync(path.join(dir, pkg.filename), pkg.name)
    const manifest = JSON.stringify({ packages })
    writeFileSync(path.join(dir, 'manifest.json'), manifest)
    writeFileSync(path.join(dir, 'clock'), '0')
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ uploads: [], views: [], ...scenario }))
    writeFileSync(
      path.join(dir, 'npm'),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.RUNNER_TEMP;
const statePath = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath));
const packages = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))).packages;
const [command, spec, field] = process.argv.slice(2);
const elapsed = Number(fs.readFileSync(path.join(dir, 'clock'), 'utf8'));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
if (command === 'publish') {
  if (state.publishFailure) { console.error('E403 forbidden'); process.exit(1); }
  const pkg = packages.find(p => path.basename(spec) === p.filename);
  state.uploads.push(pkg.name); save();
  console.log('Your package is being processed');
} else if (command === 'view') {
  state.views.push({spec, field, elapsed, uploads: [...state.uploads]}); save();
  if (state.uploads.length === packages.length && elapsed < (state.transientUntil || 0)) {
    console.error('ECONNRESET'); process.exit(1);
  }
  const pkg = packages.find(p => spec === p.name || spec === p.name + '@' + p.version);
  if (field === 'dist.integrity') {
    if (!state.existing && (!state.uploads.includes(pkg.name) || elapsed < (pkg.name === 'second' ? (state.secondVisibleAfter ?? state.visibleAfter ?? 0) : (state.visibleAfter || 0)))) {
      console.error('E404 not yet visible'); process.exit(1);
    }
    console.log(JSON.stringify(state.wrongIntegrity ? 'sha512-different' : pkg.integrity));
  } else {
    console.log(JSON.stringify(elapsed < (state.tagAfter || 0) ? '0.4.0' : pkg.version));
  }
} else { throw new Error('Unexpected npm command: ' + command); }
`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(dir, 'gh'),
      `#!/bin/sh\n${scenario.apiFailure === true ? 'exit 1' : `echo ${scenario.artifactCount ?? 0}`}\n`,
      {
        mode: 0o755,
      },
    )
    const result = spawnSync(
      'bash',
      ['-c', `sleep() { SECONDS=$((SECONDS + $1)); echo "$SECONDS" > "$RUNNER_TEMP/clock"; }\n${shell}`],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          ARTIFACT_DIR: dir,
          RUNNER_TEMP: dir,
          MANIFEST_SHA512: digest(manifest),
          NODE_AUTH_TOKEN: '',
          NPM_TOKEN: '',
          GITHUB_REPOSITORY: 'livestorejs/livestore',
          GITHUB_RUN_ID: '123',
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    return {
      ...result,
      state: JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')),
      elapsed: Number(readFileSync(path.join(dir, 'clock'), 'utf8')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('isolated npm publisher', () => {
  it('uploads the whole cohort before waiting for delayed visibility, tags, and transient reads', () => {
    const result = run({ transientUntil: 10, visibleAfter: 20, tagAfter: 30 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.state.uploads).toEqual(['first', 'second'])
    const verification = result.state.views.find(
      (view: { spec: string; uploads: string[] }) => view.spec === 'first@0.5.0' && view.uploads.length > 0,
    )
    expect(verification.uploads).toEqual(['first', 'second'])
    expect(result.elapsed).toBeGreaterThanOrEqual(30)
    expect(result.stdout).toContain('second@0.5.0 is public with matching integrity and snapshot dist-tag')
  })

  it('resumes matching uploads without republishing and waits for their tags', () => {
    const result = run({ existing: true, tagAfter: 20 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.state.uploads).toEqual([])
    expect(result.elapsed).toBeGreaterThanOrEqual(20)
  })

  it.each([{ existing: true }, { existing: false }])('rejects different registry bytes (%j)', (scenario) => {
    const result = run({ ...scenario, wrongIntegrity: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('DIFFERENT integrity')
    if (scenario.existing === true) expect(result.state.uploads).toEqual([])
  })

  it.each([
    { visibleAfter: 1000 },
    { tagAfter: 1000 },
    { transientUntil: 1000 },
    { visibleAfter: 290, secondVisibleAfter: 1000 },
  ])(
    'times out with recovery instructions when npm stays unavailable (%j)',
    (scenario) => {
      const result = run(scenario)
      expect(result.status, result.stderr).toBe(1)
      expect(result.elapsed).toBeGreaterThanOrEqual(300)
      expect(result.elapsed).toBeLessThan(310)
      expect(result.stderr).toContain('shared 5-minute visibility window')
      expect(result.stderr).toContain('Rerun only this failed publish job with its original artifact')
    },
    20_000,
  )

  it('fails on rejected uploads without publishing further packages', () => {
    const result = run({ publishFailure: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('E403 forbidden')
    expect(result.state.uploads).toEqual([])
  })

  it('uses the same publisher for stable releases', () => {
    expect(
      workflow.jobs['publish-release'].steps.find(
        (step: { name?: string }) => step.name === 'Verify bytes and publish without build code',
      ).run,
    ).toBe(publish)
  })
})

describe('release artifact protection', () => {
  it.each(['release', 'snapshot-version'])(
    'keeps ancillary uploads retryable and the guarded artifact last for %s',
    (suffix) => {
      const steps = workflow.jobs[`prepare-${suffix}`].steps
      expect(steps.at(-1).uses).toBe('actions/upload-artifact@v4')
      expect(steps.at(-1).with.name).toBe(`npm-release-${suffix}`)
      expect(steps.at(-1).with.overwrite).not.toBe(true)
      const ancillaryUploads = steps
        .slice(0, -1)
        .filter((step: { uses?: string }) => step.uses === 'actions/upload-artifact@v4')
      expect(ancillaryUploads.length).toBeGreaterThan(0)
      for (const upload of ancillaryUploads) expect(upload.with.overwrite).toBe(true)
    },
  )

  it.each(['release', 'snapshot-version'])('blocks rebuilding an existing artifact for %s', (suffix) => {
    const prepare = workflow.jobs[`prepare-${suffix}`]
    const guard = prepare.steps[0]
    expect(guard.name).toBe('Preserve the original release artifact')
    expect(guard.if).toBe('${{ github.run_attempt > 1 }}')
    expect(prepare.permissions.actions).toBe('read')
    const blocked = run({ artifactCount: 1 }, guard.run)
    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain('Do not rebuild or replace it')
    expect(run({ artifactCount: 0 }, guard.run).status).toBe(0)
    expect(run({ apiFailure: true }, guard.run).status).toBe(1)
  })
})
