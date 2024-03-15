import { type ReactElement, useState, useEffect } from 'react'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'
import { ElectricConfig } from 'electric-sql/config'
import { ElectricContext, makeElectricContext as makeElectricContextBase } from 'electric-sql/react'
import { useStore, useTemporaryQuery } from '@livestore/livestore/react'
import { electrify, DatabaseAdapter } from './index'
import { Store, computed } from '@livestore/livestore'

export interface ElectricLiveStoreProviderProps<S extends ElectricClient<DbSchema<any>>> {
  children?: React.ReactNode
  config: ElectricConfig
  dbSchema: DbSchema<any>
  init?: (electric: S) => Promise<void>
  fallback?: ReactElement
}

interface ElectricLiveStoreContext<S extends ElectricClient<DbSchema<any>>> {
  ElectricContext: React.Context<S | undefined>
  useElectric: () => S | undefined
  ElectricLiveStoreProvider: ({ children, config }: ElectricLiveStoreProviderProps<S>) => JSX.Element
}

export function makeElectricLiveStoreContext<
  S extends ElectricClient<DbSchema<any>>
>(): ElectricLiveStoreContext<S> {
  const {ElectricContext: ctx, useElectric, ElectricProvider} = makeElectricContextBase<S>()

  const ElectricReactivity = (
    { electric, dbSchema, store, children }: {
      electric: S
      dbSchema: DbSchema<any>
      store: Store
      children: React.ReactNode
    }
  ) => {
    let notifyingElectric = false

    electric.notifier.subscribeToDataChanges((notification) => {
      console.log('Electric change notification', notifyingElectric, notification)
      if (!notifyingElectric) {
        notification.changes.forEach((change) => {
          console.log(`${change.qualifiedTablename.tablename} changed by Electric`)
          store.graph.setRef(store.tableRefs[change.qualifiedTablename.tablename]!, null)
        })
      }
    })

    Object.keys(dbSchema.tables).forEach((tableName) => {
      useTemporaryQuery(() => {
        return computed(
          (get) => {
            get(store.tableRefs[tableName] as any)
            console.log(`${tableName} changed by LiveStore`)
          }
        )
      }, Object.keys(dbSchema.tables))
    })

    return <>{children}</>
  }

  const ElectricLiveStoreProvider = ({ children, config, dbSchema, fallback, init }: ElectricLiveStoreProviderProps<S>) => {
    const { store } = useStore()
    let [electric, setElectric] = useState<S>()

    useEffect(() => {
      let ignore = false

      const runInit = async () => {
        const electric = await electrify(store, dbSchema, config) as S

        // If the user has provided an init function, call it
        // this is where they can authenticate, subscribe to shapes, etc.
        if (init) {
          await init(electric)
        }

        if (!ignore) {
          setElectric(electric)
        }
      }
      runInit()

      return () => {
        // TODO: disconnect electric!
        ignore = true
      }
    }, [store])

    return (
      <ElectricProvider db={electric}>
        {electric ? 
          <ElectricReactivity electric={electric} dbSchema={dbSchema} store={store}>
            {children}
          </ElectricReactivity>
        : fallback}
      </ElectricProvider>
    )
  }

  return {
    ElectricContext: ctx,
    useElectric: useElectric,
    ElectricLiveStoreProvider,
  }
}
