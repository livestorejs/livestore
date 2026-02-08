import { describe, expect, test } from 'vitest'

import { makeInitialSnapshotsByBackendFromBootResult } from './client-session/adapter.ts'
import { makeSnapshotsByBackend } from './make-leader-worker.ts'

describe('adapter-node worker multi-backend snapshots', () => {
  test('worker snapshot export includes all backend dbs', () => {
    const dbStates = new Map([
      ['a', { export: () => Uint8Array.from([1, 1]) }],
      ['b', { export: () => Uint8Array.from([2, 2]) }],
    ]) as any

    const snapshotsByBackend = makeSnapshotsByBackend(dbStates)

    expect(snapshotsByBackend.map(([backendId]) => backendId)).toEqual(['a', 'b'])
    expect(Array.from(snapshotsByBackend[0]![1])).toEqual([1, 1])
    expect(Array.from(snapshotsByBackend[1]![1])).toEqual([2, 2])
  })

  test('client worker boot result keeps all backend snapshots', () => {
    const snapshotsByBackend = [
      ['a', Uint8Array.from([10])],
      ['b', Uint8Array.from([20])],
    ] as const

    const snapshotsMap = makeInitialSnapshotsByBackendFromBootResult({ snapshotsByBackend })

    expect(snapshotsMap.size).toBe(2)
    expect(Array.from(snapshotsMap.get('a') ?? [])).toEqual([10])
    expect(Array.from(snapshotsMap.get('b') ?? [])).toEqual([20])
  })
})
