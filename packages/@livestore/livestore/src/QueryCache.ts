import BoundMap, { BoundSet } from './bounded-collections.js'
import type { Bindable } from './util.js'

type Opaque<BaseType, BrandType = unknown> = BaseType & {
  readonly [Symbols.base]: BaseType
  readonly [Symbols.brand]: BrandType
}

namespace Symbols {
  export declare const base: unique symbol
  export declare const brand: unique symbol
}

export type CacheKey = Opaque<string, string>
type TableName = string

const ignore = ['begin', 'rollback', 'commit', 'savepoint', 'release']

// TODO: profile to see how big we need this cache to be.
const cacheSize = 200
export default class QueryCache {
  #entries = new BoundMap<CacheKey, any>(cacheSize)
  #dependencies = new Map<TableName, BoundSet<CacheKey>>()

  getKey = (sql: string, bindValues?: Bindable): CacheKey => {
    if (bindValues == null) {
      return sql as CacheKey
    }

    if (Array.isArray(bindValues)) {
      return (sql + '\n' + bindValues.join('\n')) as CacheKey
    }

    return (sql + '\n' + Object.values(bindValues).join('\n')) as CacheKey
  }

  get = (key: CacheKey) => {
    return this.#entries.get(key)
  }

  set = (queriedTables: string[], key: CacheKey, results: any) => {
    this.#entries.set(key, results)
    for (const table of queriedTables) {
      let keys = this.#dependencies.get(table)
      if (keys == null) {
        keys = new BoundSet(cacheSize)
        keys.onEvict = this.#dependencyTrackerEvicted
        this.#dependencies.set(table, keys)
      }
      keys.add(key)
    }
  }

  #dependencyTrackerEvicted = (key: CacheKey) => {
    this.#entries.delete(key)
  }

  ignoreQuery = (query: string) => {
    return ignore.some((prefix) => query.startsWith(prefix))
  }

  // The next simplest step is to create a specific implementation for invalidating
  // the expensive track list queries only when constraints data in a write overlaps with read constraints.
  //
  // As well as either:
  // a. removeing the big view (since we'll have our cache)
  // b. incrementally updating the view on insert by the EventImporter
  //
  // We'll not try to tackle any generalized approach until we have a proof of concept working.
  invalidate = (queriedTables: string[]) => {
    for (const table of queriedTables) {
      const keys = this.#dependencies.get(table)
      if (keys == null) {
        continue
      }
      for (const k of keys) {
        this.#entries.delete(k)
      }
    }
  }
}
