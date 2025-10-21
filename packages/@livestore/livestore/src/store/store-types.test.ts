import type { QueryBuilder } from '@livestore/common'
import { QueryBuilderTypeId } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { TypeId } from '../live-queries/base-class.ts'
import { queryDb, signal } from '../live-queries/mod.ts'
import { isQueryable } from './store-types.ts'

const makeQueryBuilder = (): QueryBuilder<any, any, any> =>
  ({
    [QueryBuilderTypeId]: QueryBuilderTypeId,
    ResultType: null,
    asSql: () => ({ query: 'select 1', bindValues: [], usedTables: new Set<string>() }),
    toString: () => 'select 1',
  }) as unknown as QueryBuilder<any, any, any>

describe('isQueryable', () => {
  it('identifies live query definitions', () => {
    const def = queryDb({
      query: 'select 1 as value',
      schema: Schema.Array(Schema.Struct({ value: Schema.Number })),
    })

    expect(isQueryable(def)).toBe(true)
  })

  it('identifies signal definitions', () => {
    const sig = signal(0, { label: 'count' })

    expect(isQueryable(sig)).toBe(true)
  })

  it('identifies live query instances', () => {
    const liveQueryLike = { [TypeId]: TypeId } as const

    expect(isQueryable(liveQueryLike)).toBe(true)
  })

  it('identifies query builders', () => {
    const qb = makeQueryBuilder()

    expect(isQueryable(qb)).toBe(true)
  })

  it('rejects unrelated values', () => {
    expect(isQueryable(null)).toBe(false)
    expect(isQueryable(undefined)).toBe(false)
    expect(isQueryable({})).toBe(false)
  })
})
