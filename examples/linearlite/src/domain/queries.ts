import { filterStateTable } from './schema'
import { useLocalId, useRow } from '@livestore/livestore/react'

export const useFilterState = () => {
  const localId = useLocalId()
  return useRow(filterStateTable, localId)
}
