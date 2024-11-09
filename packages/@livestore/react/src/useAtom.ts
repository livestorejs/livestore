import { type QueryInfoCol, type QueryInfoRow } from '@livestore/common'
import type { DbSchema } from '@livestore/common/schema'
import type { LiveQuery } from '@livestore/livestore'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'
import type { Dispatch, SetStateAction } from './useRow.js'

export const useAtom = <
  TQuery extends LiveQuery<any, QueryInfoRow<TTableDef> | QueryInfoCol<TTableDef, any>>,
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDefConstrained,
    boolean,
    DbSchema.TableOptions & { deriveMutations: { enabled: true } }
  >,
>(
  query$: TQuery,
): [value: TQuery['__result!'], setValue: Dispatch<SetStateAction<Partial<TQuery['__result!']>>>] => {
  const query$Ref = useQueryRef(query$)

  const { store } = useStore()

  // TODO make API equivalent to useRow
  const setValue = React.useMemo<Dispatch<SetStateAction<TQuery['__result!']>>>(() => {
    return (newValueOrFn: any) => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current) : newValueOrFn

      if (query$.queryInfo._tag === 'Row') {
        if (query$.queryInfo.table.options.isSingleton && query$.queryInfo.table.isSingleColumn) {
          store.mutate(query$.queryInfo.table.update(newValue))
        } else if (query$.queryInfo.table.options.isSingleColumn) {
          store.mutate(
            query$.queryInfo.table.update({ where: { id: query$.queryInfo.id }, values: { value: newValue } }),
          )
        } else {
          store.mutate(query$.queryInfo.table.update({ where: { id: query$.queryInfo.id }, values: newValue }))
        }
      } else {
        if (query$.queryInfo.table.options.isSingleton && query$.queryInfo.table.isSingleColumn) {
          store.mutate(query$.queryInfo.table.update({ [query$.queryInfo.column]: newValue }))
        } else {
          store.mutate(
            query$.queryInfo.table.update({
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
