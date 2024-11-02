import { Schema } from 'effect'
import { querySQL, sql } from '@livestore/livestore'
import { filterStateTable } from './schema'
import { useRow, useStore } from '@livestore/react'

export const useFilterState = () => {
  const { store } = useStore()
  return useRow(filterStateTable, store.sessionId)
}

export const issueCount$ = querySQL(sql`SELECT COUNT(id) AS c FROM issue`, {
  schema: Schema.Struct({ c: Schema.Number }).pipe(Schema.pluck('c'), Schema.Array, Schema.headOrElse()),
  label: 'TopFilter.issueCount',
})
