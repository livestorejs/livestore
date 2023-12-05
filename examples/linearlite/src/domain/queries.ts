import { filterStateTable } from './schema'
import { useRow } from '@livestore/livestore/react'

export const useFilterState = () => useRow(filterStateTable)
