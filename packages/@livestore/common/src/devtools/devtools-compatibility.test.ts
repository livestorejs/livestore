import { describe, expect, it } from 'vite-plus/test'

import { isDevtoolsProtocolVersionSupported, resolveDevtoolsProtocolVersion } from '../version.ts'

describe('DevTools protocol compatibility', () => {
  it('treats legacy pings without a protocol version as protocol 1', () => {
    expect(resolveDevtoolsProtocolVersion(undefined)).toBe(1)
    expect(isDevtoolsProtocolVersionSupported(undefined, [1])).toBe(true)
  })

  it('accepts supported protocol versions independent of package version', () => {
    expect(isDevtoolsProtocolVersionSupported(1, [1])).toBe(true)
  })

  it('rejects unsupported protocol versions', () => {
    expect(isDevtoolsProtocolVersionSupported(2, [1])).toBe(false)
  })
})
