import { querySQL, sql } from '@livestore/livestore'
import { FilterState } from './schema'

export const filterState$ = querySQL<{ value: string }>((_) => sql`SELECT * FROM app_state WHERE "id" = 'filter_state'`)
  .getFirstRow({
    defaultValue: { value: '{}' },
  })
  .pipe<FilterState>((row) => JSON.parse(row.value))
