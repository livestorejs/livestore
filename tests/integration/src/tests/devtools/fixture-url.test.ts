import { describe, expect, it } from 'vitest'

import { makeDevtoolsFixtureUrl } from '../playwright/devtools/fixture-url.ts'

describe('DevTools fixture identities', () => {
  it('uses the persisted adapter default clientId for both tabs while retaining distinct sessionIds', () => {
    const tabs = ['tab-1', 'tab-2'].map(
      (tab) =>
        new URL(makeDevtoolsFixtureUrl('http://localhost/devtools/todomvc?clientId=old&reset', tab, 'persisted')),
    )

    expect(tabs.map((tab) => tab.searchParams.has('clientId'))).toEqual([false, false])
    expect(tabs.map((tab) => tab.searchParams.get('sessionId'))).toEqual(['tab-1', 'tab-2'])
    expect(tabs.map((tab) => tab.searchParams.get('adapter'))).toEqual(['persisted', 'persisted'])
    expect(tabs.every((tab) => tab.searchParams.has('reset'))).toBe(true)
  })

  it('keeps independent in-memory leaders addressable by tab-specific clientIds', () => {
    const tabs = ['tab-1', 'tab-2'].map(
      (tab) => new URL(makeDevtoolsFixtureUrl('http://localhost/devtools/todomvc', tab, 'inmemory')),
    )

    expect(tabs.map((tab) => tab.searchParams.get('clientId'))).toEqual(['tab-1', 'tab-2'])
    expect(tabs.map((tab) => tab.searchParams.get('sessionId'))).toEqual(['tab-1', 'tab-2'])
  })
})
