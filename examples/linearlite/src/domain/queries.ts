import { Schema } from '@effect/schema'
import { querySQL, sql } from '@livestore/livestore'
import { filterStateTable } from './schema'
import { useLocalId, useRow } from '@livestore/livestore/react'

export const useFilterState = () => {
  const localId = useLocalId()
  return useRow(filterStateTable, localId)
}

export const issueCount$ = querySQL(sql`SELECT COUNT(id) AS c FROM issue`, {
  schema: Schema.Struct({ c: Schema.Number }).pipe(Schema.pluck('c'), Schema.Array, Schema.headOrElse()),
  label: 'TopFilter.issueCount',
})
