import type { DerivedMutationHelperFns, QueryInfo } from '@livestore/common'
import type { DbSchema } from '@livestore/common/schema'
import type { SqliteDsl } from '@livestore/db-schema'
import type { LiveQuery } from '@livestore/livestore'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'
import type { Dispatch, SetStateAction } from './useRow.js'

export const useAtom = <
  // TODO also support colJsonValue
  TQuery extends LiveQuery<any, QueryInfo.Row | QueryInfo.Col>,
>(
  query$: TQuery,
): [value: TQuery['__result!'], setValue: Dispatch<SetStateAction<Partial<TQuery['__result!']>>>] => {
  const query$Ref = useQueryRef(query$)

  const { store } = useStore()

  // TODO make API equivalent to useRow
  const setValue = React.useMemo<Dispatch<SetStateAction<TQuery['__result!']>>>(() => {
    return (newValueOrFn: any) => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current) : newValueOrFn
      const table = query$.queryInfo.table as DbSchema.TableDef &
        DerivedMutationHelperFns<SqliteDsl.Columns, DbSchema.TableOptions>

      if (query$.queryInfo._tag === 'Row') {
        if (table.options.isSingleton && table.options.isSingleColumn) {
          store.mutate(table.update(newValue))
        } else if (table.options.isSingleColumn) {
          store.mutate(table.update({ where: { id: query$.queryInfo.id }, values: { value: newValue } }))
        } else {
          store.mutate(table.update({ where: { id: query$.queryInfo.id }, values: newValue }))
        }
      } else {
        if (table.options.isSingleton && table.options.isSingleColumn) {
          store.mutate(table.update({ [query$.queryInfo.column]: newValue }))
        } else {
          store.mutate(
            table.update({
              where: { id: query$.queryInfo.id },
              values: { [query$.queryInfo.column]: newValue },
            }),
          )
        }
      }
    }
  }, [query$.queryInfo, query$Ref, store])

  return [query$Ref.current, setValue]
}
