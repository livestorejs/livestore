import { BootStatus, QueryBuilder } from '@livestore/livestore'
import React from 'react'
import { FilterState, tables } from './schema'

export const renderBootStatus = (bootStatus: BootStatus) => {
  switch (bootStatus.stage) {
    case 'loading':
      return <div>Loading LiveStore...</div>
    case 'migrating':
      return (
        <div>
          Migrating tables ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'rehydrating':
      return (
        <div>
          Rehydrating state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'syncing':
      return (
        <div>
          Syncing state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'done':
      return <div>LiveStore ready</div>
  }
}

export const filterStateToWhere = (filterState: FilterState) => {
  const { status, priority, query } = filterState

  return {
    status: status ? { op: 'IN', value: status } : undefined,
    priority: priority ? { op: 'IN', value: priority } : undefined,
    // TODO treat query as `OR` in
    title: query ? { op: 'LIKE', value: `%${query}%` } : undefined,
  } satisfies QueryBuilder.WhereParams<typeof tables.issue>
}

export const filterStateToOrderBy = (filterState: FilterState) => [
  { col: filterState.orderBy, direction: filterState.orderDirection },
]
