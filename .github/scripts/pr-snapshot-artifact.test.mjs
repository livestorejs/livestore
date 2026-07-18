import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { createManifest, hasCurrentHeadApproval, snapshotTag, validateManifest } from './pr-snapshot-artifact.mjs'

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

const fixture = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livestore-pr-snapshot-'))
  const artifactDir = path.join(dir, 'artifact')
  await mkdir(artifactDir)
  const topologyPath = path.join(dir, 'topology.json')
  const headSha = 'a'.repeat(40)
  const version = `0.0.0-snapshot-${headSha}`
  const packageNames = ['@livestore/a', '@livestore/b']
  await writeFile(topologyPath, JSON.stringify({ publishablePackageNames: packageNames }))
  for (const name of packageNames) {
    const file = `${name.slice('@livestore/'.length)}.tgz`
    const packageJson = {
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

test('derives an immutable tag for each PR head cohort', () => {
  const firstHead = 'a'.repeat(40)
  const secondHead = 'b'.repeat(40)
  const firstTag = snapshotTag({ prNumber: 42, headSha: firstHead })

  assert.equal(firstTag, `pr-42-${firstHead}`)
  assert.notEqual(firstTag, snapshotTag({ prNumber: 42, headSha: secondHead }))
  assert.notEqual(firstTag, snapshotTag({ prNumber: 43, headSha: firstHead }))
  assert.notEqual(firstTag, 'snapshot')
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
