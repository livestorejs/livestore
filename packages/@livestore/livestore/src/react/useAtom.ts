import React from 'react'

import { type QueryInfoCol, type QueryInfoRow, storeEventForQueryInfo } from '../query-info.js'
import type { LiveQuery } from '../reactiveQueries/base-class.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'
import type { Dispatch, SetStateAction } from './useRow.js'

export const useAtom = <TQuery extends LiveQuery<any, QueryInfoRow<any> | QueryInfoCol<any, any>>>(
  query$: TQuery,
): [value: TQuery['__result!'], setValue: Dispatch<SetStateAction<TQuery['__result!']>>] => {
  const query$Ref = useQueryRef(query$)

  const { store } = useStore()

  const setValue = React.useMemo<Dispatch<SetStateAction<TQuery['__result!']>>>(() => {
    return (newValueOrFn: any) => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(query$Ref.current) : newValueOrFn

      store.applyEvents([storeEventForQueryInfo(query$.queryInfo!, newValue)])
    }
  }, [query$.queryInfo, query$Ref, store])

  return [query$Ref.current, setValue]
}
