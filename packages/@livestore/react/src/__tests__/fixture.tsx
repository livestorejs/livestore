import React from 'react'

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
import { Effect, type Scope } from '@livestore/utils/effect'

import * as LiveStoreReact from '../mod.ts'

// Re-export shared types and schema
export { events, schema, tables }
export type { AppState, Filter, Todo }

export type MakeTodoMvcReactOptions = CreateTodoMvcStoreOptions & {
  strictMode?: boolean | undefined
}

export const makeTodoMvcReact: (opts?: MakeTodoMvcReactOptions) => Effect.Effect<
  {
    wrapper: ({ children }: any) => React.JSX.Element
    store: Store<typeof schema> & LiveStoreReact.ReactApi
    renderCount: { readonly val: number; inc: () => void }
  },
  UnknownError,
  Scope.Scope
> = (opts: MakeTodoMvcReactOptions = {}) =>
  Effect.gen(function* () {
    const { strictMode } = opts
    const makeRenderCount = () => {
      let val = 0

      const inc = () => {
        val += strictMode ? 0.5 : 1
      }

      return {
        get val() {
          return val
        },
        inc,
      }
    }

    const store = yield* createTodoMvcStore(opts)

    const storeWithReactApi = LiveStoreReact.withReactApi(store)

    const MaybeStrictMode = strictMode ? React.StrictMode : React.Fragment

    const wrapper = ({ children }: any) => <MaybeStrictMode>{children}</MaybeStrictMode>

    const renderCount = makeRenderCount()

    return { wrapper, store: storeWithReactApi, renderCount }
  })
