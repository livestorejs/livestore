import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const processorSource = readFileSync(
  new URL('../../../../packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts', import.meta.url),
  'utf8',
)
const leaderLayerSource = readFileSync(
  new URL('../../../../packages/@livestore/common/src/leader-thread/make-leader-thread-layer.ts', import.meta.url),
  'utf8',
)

describe('LeaderSyncProcessor architecture', () => {
  it('does not depend on or capture LeaderThreadCtx', () => {
    expect(processorSource).not.toContain('LeaderThreadCtx')
    expect(processorSource).not.toContain('Effect.context')
    expect(processorSource).not.toContain('ctxRef')
  })

  it('constructs runtime dependencies and the processor before the leader aggregate', () => {
    const materializeEventIndex = leaderLayerSource.indexOf('const materializeEvent =')
    const devtoolsContextIndex = leaderLayerSource.indexOf('const devtoolsContext =')
    const syncProcessorIndex = leaderLayerSource.indexOf('const syncProcessor =')
    const leaderAggregateIndex = leaderLayerSource.indexOf('const ctx =')

    expect(materializeEventIndex).toBeGreaterThan(-1)
    expect(devtoolsContextIndex).toBeGreaterThan(materializeEventIndex)
    expect(syncProcessorIndex).toBeGreaterThan(devtoolsContextIndex)
    expect(leaderAggregateIndex).toBeGreaterThan(syncProcessorIndex)
  })
})
