import { cuid } from '@livestore/utils/cuid'
import React from 'react'

type LocalIdOptions = {
  key: string
  storageType: 'session' | 'local'
  storageKeyPrefix: string
  makeId: () => string
}

export const useLocalId = (opts?: Partial<LocalIdOptions>) => React.useMemo(() => getLocalId(opts), [opts])

export const getLocalId = (opts?: Partial<LocalIdOptions>) => {
  // TODO find a better way to handle this
  // Currently `getLocalId` gets imported and called in some worker-side code
  // during development where Vite isn't tree-shaking yet.
  if (typeof window === 'undefined' || window.localStorage === undefined || window.sessionStorage === undefined) {
    return ''
  }

  const { key = '', storageType = 'session', storageKeyPrefix = 'livestore:localid:', makeId = cuid } = opts ?? {}

  const storage = storageType === 'session' ? window.sessionStorage : window.localStorage
  const fullKey = `${storageKeyPrefix}:${key}`
  const storedKey = storage.getItem(fullKey)

  if (storedKey) return storedKey

  const newKey = makeId()
  storage.setItem(fullKey, newKey)

  return newKey
}
