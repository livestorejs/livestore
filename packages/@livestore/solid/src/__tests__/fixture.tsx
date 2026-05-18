import type * as Solid from 'solid-js'

import type { UnknownError } from '@livestore/common'
import {
  type AppState,
  type CreateTodoMvcStoreOptions,
  createTodoMvcStore,
  events,
  type Filter,
  schema,
  type Todo,
  tables,
} from '@livestore/framework-toolkit/testing'
import type { Store } from '@livestore/livestore'
import { StoreInternalsSymbol } from '@livestore/livestore'
import { Effect, type Scope } from '@livestore/utils/effect'

import * as LiveStoreSolid from '../mod.ts'

// Re-export shared types, schema, and StoreInternalsSymbol for tests
export { events, schema, StoreInternalsSymbol, tables }
export type { AppState, Filter, Todo }

export const makeTodoMvcSolid = (
  opts: CreateTodoMvcStoreOptions = {},
): Effect.Effect<
  {
    wrapper: ({ children }: any) => Solid.JSX.Element
    store: Store<typeof schema> & LiveStoreSolid.SolidApi
  },
  UnknownError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* createTodoMvcStore(opts)

    const storeWithSolidApi = LiveStoreSolid.withSolidApi(store)

    const wrapper = (props: Solid.ParentProps) => <>{props.children}</>

    return { wrapper, store: storeWithSolidApi }
  })
