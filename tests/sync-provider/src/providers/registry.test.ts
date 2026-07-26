import { afterEach, describe, expect, it } from 'vitest'

import { isProviderSelected, providerKeys, providerSelectionEnvVar, selectedProviderKeys } from './registry.ts'

const originalSelection = process.env[providerSelectionEnvVar]

const withSelection = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[providerSelectionEnvVar]
  } else {
    process.env[providerSelectionEnvVar] = value
  }
}

afterEach(() => withSelection(originalSelection))

describe('provider selection', () => {
  it('runs every provider when unpinned', () => {
    withSelection(undefined)

    expect(selectedProviderKeys()).toEqual(providerKeys)
  })

  it('narrows to the pinned provider', () => {
    withSelection('cf-ws-do')

    expect(selectedProviderKeys()).toEqual(['cf-ws-do'])
    expect(isProviderSelected('cf-ws-do')).toBe(true)
    expect(isProviderSelected('cf-http-d1')).toBe(false)
  })

  it('throws on an unknown provider instead of selecting nothing', () => {
    withSelection('cf-typo')

    expect(() => selectedProviderKeys()).toThrow(/Unknown TEST_SYNC_PROVIDER/)
  })
})
