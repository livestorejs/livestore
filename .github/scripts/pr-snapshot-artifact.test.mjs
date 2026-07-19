import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  assessRegistryCohort,
  createManifest,
  hasCurrentHeadApproval,
  isAuthorizedReviewState,
  selectEligibleProducerRun,
  snapshotTag,
  snapshotVersion,
  successfulProducerAttempt,
  validateManifest,
} from './pr-snapshot-artifact.mjs'

test('requires a trusted verification receipt before declaring a registry cohort complete', () => {
  const version = `0.0.0-snapshot-pr.42.${'a'.repeat(40)}`
  const matching = [
    { name: '@livestore/common', version, tag: '' },
    { name: '@livestore/utils', version, tag: version },
  ]

  assert.deepEqual(
    assessRegistryCohort({ expectedVersion: version, packageStates: matching, hasVerifiedReceipt: false }),
    { action: 'dispatch' },
  )
  assert.deepEqual(
    assessRegistryCohort({ expectedVersion: version, packageStates: matching, hasVerifiedReceipt: true }),
    { action: 'complete' },
  )
  assert.deepEqual(
    assessRegistryCohort({
      expectedVersion: version,
      packageStates: [{ name: '@livestore/common', version: '', tag: '' }],
      hasVerifiedReceipt: true,
    }),
    { action: 'dispatch' },
  )
  assert.deepEqual(
    assessRegistryCohort({
      expectedVersion: version,
      packageStates: [{ name: '@livestore/common', version, tag: 'another-version' }],
      hasVerifiedReceipt: true,
    }),
    { action: 'conflict', packageName: '@livestore/common', conflictingVersion: 'another-version' },
  )
})

const writeOctal = (header, start, length, value) => {
  const encoded = value.toString(8).padStart(length - 1, '0')
  header.write(encoded, start, length - 1, 'ascii')
  header[start + length - 1] = 0
}

const tar = (entries) => {
  const chunks = []
  for (const [name, content] of entries) {
    const body = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, body.length)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = '0'.charCodeAt(0)
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    writeOctal(
      header,
      148,
      8,
      header.reduce((sum, byte) => sum + byte, 0),
    )
    chunks.push(header, body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length))
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks))
}

const fixture = async ({ includeDevtools = false } = {}) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livestore-pr-snapshot-'))
  const artifactDir = path.join(dir, 'artifact')
  await mkdir(artifactDir)
  const topologyPath = path.join(dir, 'topology.json')
  const headSha = 'a'.repeat(40)
  const version = `0.0.0-snapshot-pr.42.${headSha}`
  const packageNames = [
    '@livestore/a',
    '@livestore/b',
    ...(includeDevtools === true ? ['@livestore/devtools-vite'] : []),
  ]
  await writeFile(topologyPath, JSON.stringify({ snapshotPackageNames: packageNames }))
  for (const name of packageNames) {
    const file = `${name.slice('@livestore/'.length)}.tgz`
    const packageJson =
      name === '@livestore/devtools-vite'
        ? {
            name,
            version,
            dependencies: { '@parcel/watcher': '^2.5.0' },
            peerDependencies: {
              '@livestore/adapter-web': version,
              '@livestore/utils': version,
              vite: '^7.3.1 || ^8.0.16',
            },
          }
        : {
            name,
            version,
            dependencies: name.endsWith('/b') === true ? { '@livestore/a': version } : {},
            scripts: { test: 'node --test' },
          }
    await writeFile(
      path.join(artifactDir, file),
      tar([
        ['package/package.json', JSON.stringify(packageJson)],
        ['package/dist/index.js', 'export {}\n'],
      ]),
    )
  }
  return { dir: artifactDir, topologyPath, headSha, version }
}

test('creates and validates an exact-run package cohort', async () => {
  const { dir, topologyPath, headSha, version } = await fixture()
  await createManifest({
    artifactDir: dir,
    topologyPath,
    repository: 'livestorejs/livestore',
    prNumber: 42,
    headSha,
    runId: 100,
    runAttempt: 2,
  })
  const publishListPath = path.join(dir, '..', 'publish-list.txt')
  const result = await validateManifest({
    artifactDir: dir,
    topologyPath,
    repository: 'livestorejs/livestore',
    prNumber: 42,
    headSha,
    runId: 100,
    runAttempt: 2,
    publishListPath,
  })
  assert.equal(result.version, version)
  assert.equal(result.npmTag, `pr-42-${headSha}`)
  assert.equal(result.packageCount, 2)
  assert.match(result.manifestDigest, /^[0-9a-f]{64}$/)
  assert.equal(await readFile(publishListPath, 'utf8'), '@livestore/a\ta.tgz\n@livestore/b\tb.tgz\n')
})

test('requires the repacked DevTools dependency boundary', async () => {
  const { dir, topologyPath, headSha, version } = await fixture({ includeDevtools: true })
  const devtoolsPath = path.join(dir, 'devtools-vite.tgz')

  const writeDevtools = async (packageJson) =>
    writeFile(devtoolsPath, tar([['package/package.json', JSON.stringify(packageJson)]]))

  await writeDevtools({
    name: '@livestore/devtools-vite',
    version,
    dependencies: { '@parcel/watcher': '^2.5.0' },
    peerDependencies: { '@livestore/adapter-web': version, vite: '^7.3.1 || ^8.0.16' },
  })
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /requires exact peer @livestore\/utils/,
  )

  await writeDevtools({
    name: '@livestore/devtools-vite',
    version,
    dependencies: { '@livestore/adapter-web': version, '@parcel/watcher': '^2.5.0', vite: '*' },
    peerDependencies: {
      '@livestore/adapter-web': version,
      '@livestore/utils': version,
      vite: '^7.3.1 || ^8.0.16',
    },
  })
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /runtime dependencies must contain only @parcel\/watcher/,
  )
})

test('requires an approval for the unchanged head', () => {
  const oldHead = 'a'.repeat(40)
  const currentHead = 'b'.repeat(40)
  const reviews = [{ state: 'APPROVED', commit_id: oldHead }]

  assert.equal(hasCurrentHeadApproval({ headSha: oldHead, currentHeadSha: currentHead, reviews }), false)
  assert.equal(hasCurrentHeadApproval({ headSha: currentHead, currentHeadSha: currentHead, reviews }), false)
  assert.equal(
    hasCurrentHeadApproval({
      headSha: currentHead,
      currentHeadSha: currentHead,
      reviews: [...reviews, { state: 'APPROVED', commit_id: currentHead }],
    }),
    true,
  )
})

test('requires the authoritative required-review decision', () => {
  const headSha = 'a'.repeat(40)
  const approvedReview = { state: 'APPROVED', commit_id: headSha }

  assert.equal(
    isAuthorizedReviewState({
      headSha,
      currentHeadSha: headSha,
      reviewDecision: 'REVIEW_REQUIRED',
      reviews: [approvedReview],
    }),
    false,
    'a non-counting approval must not authorize',
  )
  assert.equal(
    isAuthorizedReviewState({
      headSha,
      currentHeadSha: headSha,
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [approvedReview, { state: 'CHANGES_REQUESTED', commit_id: headSha }],
    }),
    false,
    'a later changes-requested decision must not authorize',
  )
  assert.equal(
    isAuthorizedReviewState({
      headSha,
      currentHeadSha: headSha,
      reviewDecision: 'APPROVED',
      reviews: [approvedReview],
    }),
    true,
  )
})

test('generated promotion workflow is anchored to trusted main', async () => {
  const workflow = await readFile(new URL('../workflows/release.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /pull_request_review:/)
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/)
  const dispatchStart = workflow.indexOf('\n  dispatch-approved-pr-snapshots:')
  const validateStart = workflow.indexOf('\n  validate-pr-snapshot:', dispatchStart)
  const dispatch = workflow.slice(dispatchStart, validateStart)
  assert.match(dispatch, /actions: write/)
  assert.doesNotMatch(dispatch, /id-token: write/)
  assert.match(dispatch, /gh workflow run release\.yml.*--ref main/s)
  assert.match(dispatch, /pulls\?state=open&base=main&per_page=100.*--slurp/)
  assert.match(dispatch, /pullRequest\(number:\$number\)\{reviewDecision\}/)
  assert.match(dispatch, /reviewDecision.*APPROVED/s)
  assert.match(dispatch, /any\(\.pull_requests\[\]\?; \.number == \$pr_number and \.head\.sha == \$sha\)/)
  assert.match(dispatch, /pack-pr-snapshot.*conclusion == "success"/s)
  assert.match(dispatch, /artifacts\?per_page=100.*expired == false/s)
  assert.match(dispatch, /ci_run_id="\$selected_run_id"/)
  assert.match(dispatch, /selected_pack_attempt="\$pack_attempt"/)
  assert.match(dispatch, /verified-pr-snapshot-\$head_sha-\$selected_run_id-\$selected_pack_attempt/)
  assert.match(dispatch, /assess-registry.*--verified-receipt="\$verified_receipt"/s)
  assert.match(dispatch, /cohort_failed=true.*scan_failed=true.*continue/s)
  assert.match(dispatch, /if \[ "\$scan_failed" = true \]; then\s+exit 1/s)
  assert.match(dispatch, /\.snapshotPackageNames\[\]/)

  const checkoutStart = workflow.indexOf('- name: Checkout trusted validator only')
  const checkoutEnd = workflow.indexOf('\n      - name: Use pinned Node validator runtime', checkoutStart)
  assert.notEqual(checkoutStart, -1)
  assert.notEqual(checkoutEnd, -1)
  const checkout = workflow.slice(checkoutStart, checkoutEnd)
  assert.match(checkout, /ref: \$\{\{ github\.workflow_sha \}\}/)
  assert.doesNotMatch(checkout, /github\.sha|head-sha/)

  const attestStart = workflow.indexOf('\n  attest-pr-snapshot:', validateStart)
  const authorizeStart = workflow.indexOf('\n  authorize-pr-snapshot:', attestStart)
  const publishStart = workflow.indexOf('\n  publish-pr-snapshot:', authorizeStart)
  const nextJobStart = workflow.indexOf('\n  create-release-pr:', publishStart)
  assert.match(workflow.slice(validateStart, attestStart), /GITHUB_WORKFLOW_REF.*refs\/heads\/main/)
  assert.match(workflow.slice(validateStart, attestStart), /workflow_dispatch.*refs\/heads\/main.*promote-pr-snapshot/s)
  assert.doesNotMatch(workflow.slice(validateStart, attestStart), /id-token: write/)
  assert.match(workflow.slice(validateStart, attestStart), /pull-requests: read/)
  assert.match(workflow.slice(attestStart, authorizeStart), /id-token: write/)
  assert.match(workflow.slice(authorizeStart, publishStart), /pull-requests: read/)

  const publish = workflow.slice(publishStart, nextJobStart)
  assert.match(publish, /pull-requests: read/)
  assert.match(publish, /group: 'pr-snapshot-\$\{\{ needs\.validate-pr-snapshot\.outputs\.head-sha \}\}'/)
  assert.match(publish, /\.base\.ref/)
  assert.match(publish, /\.head\.repo\.full_name/)
  assert.doesNotMatch(publish, /npm dist-tag/)
  assert.match(publish, /npm publish/)
  assert.match(workflow.slice(validateStart, attestStart), /jobs\?filter=all/)
  assert.match(workflow.slice(validateStart, attestStart), /sort_by\(\.run_attempt\) \| last/)
  assert.match(workflow.slice(validateStart, attestStart), /inputs\.ci_run_id/)
  assert.match(workflow.slice(validateStart, attestStart), /\.pull_requests\[0\]\.head\.sha/)
  assert.match(workflow, /validated-pr-snapshot-.*release-run-attempt/)
  assert.match(workflow, /promotion-pr-snapshot-.*promotion-attempt/)

  assert.match(publish, /Verify complete immutable registry cohort/)
  assert.match(publish, /dist\.integrity/)
  assert.match(publish, /dist-tags/)
  assert.match(publish, /\[ -n "\$remote_tag" \].*\[ "\$remote_tag" != "\$SNAPSHOT_VERSION" \]/s)
  assert.match(publish, /mutable tag \$SNAPSHOT_TAG is absent; OIDC publishing cannot repair dist-tags/)
  assert.match(publish, /\[ "\$remote_integrity" = "\$local_integrity" \]/)
  assert.doesNotMatch(publish, /\[ "\$remote_tag" = "\$SNAPSHOT_VERSION" \]/)
  assert.match(publish, /needs\.validate-pr-snapshot\.outputs\.package-count/)
  assert.match(publish, /Upload trusted verification receipt/)
  assert.match(publish, /verified-pr-snapshot-.*outputs\.head-sha.*outputs\.run-id.*outputs\.run-attempt/s)
  assert.match(publish, /sourceRunAttempt/)
  assert.match(publish, /overwrite: true/)

  const ciWorkflow = await readFile(new URL('../workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(
    ciWorkflow,
    /name: 'pr-snapshot-\$\{\{ github\.event\.pull_request\.head\.sha \}\}-\$\{\{ github\.run_attempt \}\}'/,
  )
  assert.match(
    workflow.slice(validateStart, attestStart),
    /name: 'pr-snapshot-\$\{\{ steps\.identity\.outputs\.head-sha \}\}-\$\{\{ steps\.identity\.outputs\.run-attempt \}\}'/,
  )
})

test('generated snapshot topology includes externally repacked DevTools', async () => {
  const topology = JSON.parse(
    await readFile(new URL('../../scripts/src/generated/release-topology.json', import.meta.url), 'utf8'),
  )

  assert.equal(topology.publishablePackageNames.includes('@livestore/devtools-vite'), false)
  assert.equal(topology.snapshotPackageNames.includes('@livestore/devtools-vite'), true)
  assert.deepEqual(topology.externalSnapshotPackages, [
    { name: '@livestore/devtools-vite', manifest: 'release/devtools-artifact.json' },
  ])
})

test('derives a deterministic publish-time tag for each PR head cohort', () => {
  const firstHead = 'a'.repeat(40)
  const secondHead = 'b'.repeat(40)
  const firstTag = snapshotTag({ prNumber: 42, headSha: firstHead })

  assert.equal(firstTag, `pr-42-${firstHead}`)
  assert.notEqual(firstTag, snapshotTag({ prNumber: 42, headSha: secondHead }))
  assert.notEqual(firstTag, snapshotTag({ prNumber: 43, headSha: firstHead }))
  assert.notEqual(firstTag, 'snapshot')
  assert.notEqual(
    snapshotVersion({ prNumber: 42, headSha: firstHead }),
    snapshotVersion({ prNumber: 43, headSha: firstHead }),
  )
})

test('selects the successful producer attempt when only failed jobs were rerun', () => {
  assert.equal(
    successfulProducerAttempt({
      jobName: 'pack-pr-snapshot',
      jobs: [
        { name: 'pack-pr-snapshot', conclusion: 'success', run_attempt: 1 },
        { name: 'lint', conclusion: 'success', run_attempt: 2 },
      ],
    }),
    1,
  )

  assert.equal(
    successfulProducerAttempt({
      jobName: 'pack-pr-snapshot',
      jobs: [
        { name: 'pack-pr-snapshot', conclusion: 'success', run_attempt: 1 },
        { name: 'pack-pr-snapshot', conclusion: 'success', run_attempt: 2 },
      ],
    }),
    2,
  )
})

test('selects an exact PR-associated run when multiple PRs share a head SHA', () => {
  const headSha = 'a'.repeat(40)
  const artifact = (attempt) => ({ name: `pr-snapshot-${headSha}-${attempt}`, expired: false })
  const runs = [
    {
      id: 100,
      headSha: 'c'.repeat(40),
      event: 'pull_request',
      conclusion: 'success',
      pullRequests: [{ number: 41, headSha }],
      packAttempt: 1,
      artifacts: [artifact(1)],
      createdAt: '2026-07-18T10:00:00Z',
    },
    {
      id: 101,
      headSha: 'd'.repeat(40),
      event: 'pull_request',
      conclusion: 'success',
      pullRequests: [{ number: 42, headSha }],
      packAttempt: 2,
      artifacts: [artifact(2)],
      createdAt: '2026-07-18T09:00:00Z',
    },
  ]

  assert.equal(selectEligibleProducerRun({ runs, prNumber: 42, headSha })?.id, 101)
  assert.equal(selectEligibleProducerRun({ runs, prNumber: 43, headSha }), null)
  runs[1].artifacts[0].expired = true
  assert.equal(selectEligibleProducerRun({ runs, prNumber: 42, headSha }), null)
})

test('rejects a tarball changed after manifest creation', async () => {
  const { dir, topologyPath, headSha } = await fixture()
  await createManifest({
    artifactDir: dir,
    topologyPath,
    repository: 'livestorejs/livestore',
    prNumber: 42,
    headSha,
    runId: 100,
    runAttempt: 1,
  })
  await writeFile(path.join(dir, 'a.tgz'), Buffer.from('tampered'))
  await assert.rejects(
    validateManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
      publishListPath: path.join(dir, '..', 'publish-list.txt'),
    }),
    /Digest mismatch/,
  )
})

test('rejects identity drift and unexpected artifact files', async () => {
  const { dir, topologyPath, headSha } = await fixture()
  await createManifest({
    artifactDir: dir,
    topologyPath,
    repository: 'livestorejs/livestore',
    prNumber: 42,
    headSha,
    runId: 100,
    runAttempt: 1,
  })
  await assert.rejects(
    validateManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 101,
      runAttempt: 1,
      publishListPath: path.join(dir, '..', 'publish-list.txt'),
    }),
    /runId mismatch/,
  )

  await writeFile(path.join(dir, 'unexpected.txt'), 'unexpected')
  await assert.rejects(
    validateManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
      publishListPath: path.join(dir, '..', 'publish-list.txt'),
    }),
    /missing or unexpected files/,
  )
})

test('rejects traversal paths and lifecycle scripts', async () => {
  const { dir, topologyPath, headSha, version } = await fixture()
  await writeFile(
    path.join(dir, 'a.tgz'),
    tar([
      ['package/../escape', 'x'],
      ['package/package.json', JSON.stringify({ name: '@livestore/a', version })],
    ]),
  )
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /Unsafe tar entry path/,
  )

  await writeFile(
    path.join(dir, 'a.tgz'),
    tar([
      ['package/package.json', JSON.stringify({ name: '@livestore/a', version, scripts: { prepare: 'echo unsafe' } })],
    ]),
  )
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /lifecycle script prepare/,
  )

  await writeFile(
    path.join(dir, 'a.tgz'),
    tar([
      [
        'package/package.json',
        JSON.stringify({
          name: '@livestore/a',
          version,
          publishConfig: { access: 'public', registry: 'https://attacker.example' },
        }),
      ],
    ]),
  )
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /publishConfig keys mismatch/,
  )

  await writeFile(
    path.join(dir, 'a.tgz'),
    tar([
      ['package/.npmrc', 'registry=https://attacker.example'],
      ['package/package.json', JSON.stringify({ name: '@livestore/a', version })],
    ]),
  )
  await assert.rejects(
    createManifest({
      artifactDir: dir,
      topologyPath,
      repository: 'livestorejs/livestore',
      prNumber: 42,
      headSha,
      runId: 100,
      runAttempt: 1,
    }),
    /must not contain .npmrc/,
  )
})
