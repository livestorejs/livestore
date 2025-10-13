import type { Adapter, MigrationsReport } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { LiveQueryDef, Store } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import type { Effect, OtelTracer } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { ReactApi } from '../LiveStoreContext.js'

/**
 * Helper to future‑proof adapter/schema coupling.
 * Replace `AdapterFor<TSchema>` with `Adapter<TSchema>` when `Adapter` accepts a generic schema parameter.
 */
type AdapterFor<TSchema extends LiveStoreSchema> = Adapter

type StoreDescriptor<TSchema extends LiveStoreSchema> = {
  /**
   * Schema describing the data structure.
   */
  readonly schema: TSchema

  /**
   * Adapter for persistence and synchronization.
   */
  readonly adapter: AdapterFor<TSchema>

  /**
   * The ID of the store instance.
   */
  readonly storeId: string
}

type MakeStoreApiOptions<TSchema extends LiveStoreSchema> = StoreDescriptor<TSchema> & {
  /**
   * Function called when store instance's loading completes.
   */
  boot?: (
    store: Store<TSchema>,
    ctx: {
      migrationsReport: MigrationsReport
      parentSpan: otel.Span
    },
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
}

type StoreApi<TSchema extends LiveStoreSchema> = {
  useStore: () => Store<TSchema> & ReactApi

  useQuery: <TQuery extends LiveQueryDef.Any>(queryDef: TQuery) => LiveQueries.GetResult<TQuery>
}

export declare function makeStoreApi<TSchema extends LiveStoreSchema>(
  options: MakeStoreApiOptions<TSchema>,
): StoreApi<TSchema>

export declare function useStoreRegistry(override?: StoreRegistry): StoreRegistry

type PreloadStoreOptions<TSchema extends LiveStoreSchema> = StoreDescriptor<TSchema> & {}

export declare class StoreRegistry {
  constructor()

  get<TSchema extends LiveStoreSchema>(options: StoreDescriptor<TSchema> & {}): Promise<Store<TSchema>>

  preloadStore<TSchema extends LiveStoreSchema>(options: PreloadStoreOptions<TSchema>): Promise<void>

  retain<TSchema extends LiveStoreSchema>(options: StoreDescriptor<TSchema> & {}): () => void

  release<TSchema extends LiveStoreSchema>(options: StoreDescriptor<TSchema> & {}): void
}

export declare function MultiStoreProvider(props: {
  children: React.ReactNode
  storeRegistry: StoreRegistry
}): React.JSX.Element
