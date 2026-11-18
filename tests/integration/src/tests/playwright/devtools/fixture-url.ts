/** Persisted tabs share a client identity; only their session identities differ. */
export const makeDevtoolsFixtureUrl = (url: string, tabName: string, adapter: 'persisted' | 'inmemory'): string => {
  const target = new URL(url)
  target.searchParams.set('sessionId', tabName)
  target.searchParams.set('adapter', adapter)

  if (adapter === 'inmemory') {
    // Each in-memory tab owns its own leader and database.
    target.searchParams.set('clientId', tabName)
  } else {
    // Exercise the real adapter default: localStorage supplies one clientId across tabs.
    target.searchParams.delete('clientId')
  }

  return target.toString()
}
