import { type ReactElement, useState, useEffect } from 'react'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'
import { ElectricConfig } from 'electric-sql/config'
import { ElectricContext, makeElectricContext as makeElectricContextBase } from 'electric-sql/react'
import { useStore, useTemporaryQuery } from '@livestore/livestore/react'
import { electrify, DatabaseAdapter } from './index'
import { Store, computed } from '@livestore/livestore'
import { set } from 'zod'

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

export function makeElectricLiveStoreContext<S extends ElectricClient<DbSchema<any>>>(): ElectricLiveStoreContext<S> {
  const { ElectricContext: ctx, useElectric, ElectricProvider } = makeElectricContextBase<S>()

  const ElectricReactivity = ({
    electric,
    dbSchema,
    store,
    children,
  }: {
    electric: S
    dbSchema: DbSchema<any>
    store: Store
    children: React.ReactNode
  }) => {
    let notifyingElectric = false

    electric.notifier.subscribeToDataChanges((notification: any) => { // TODO: type this
      if (!notifyingElectric) {
        notification.changes.forEach((change: any) => { // TODO: type this
          store.mainDbWrapper.invalidateCache([change.qualifiedTablename.tablename])
          store.graph.setRef(store.tableRefs[change.qualifiedTablename.tablename]!, null)
        })
      }
    })

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTemporaryQuery(() => {
      return computed((get) => {
        if (notifyingElectric) return
        for (const tableName in dbSchema.tables) {
          get(store.tableRefs[tableName] as any)
        }
        notifyingElectric = true
        // We want to move the electric snapshot to the next tick after any rendering
        // so we use a setTimeout with 0ms to schedule a (non-micro) task.
        setTimeout(() => {
          electric.notifier.potentiallyChanged()
          notifyingElectric = false
        }, 0)
      })
    }, dbSchema.tables)

    return <>{children}</>
  }

  const ElectricLiveStoreProvider = ({
    children,
    config,
    dbSchema,
    fallback,
    init,
  }: ElectricLiveStoreProviderProps<S>): JSX.Element => {
    const { store } = useStore()
    const [electric, setElectric] = useState<S>()

    useEffect(() => {
      let ignore = false

      const runInit = async () => {
        const electric = (await electrify(store, dbSchema, config)) as S

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
    }, [config, dbSchema, init, store])

    return (
      <ElectricProvider db={electric}>
        {electric ? (
          <ElectricReactivity electric={electric} dbSchema={dbSchema} store={store}>
            {children}
          </ElectricReactivity>
        ) : (
          fallback
        )}
      </ElectricProvider>
    )
  }

  return {
    ElectricContext: ctx,
    useElectric: useElectric,
    ElectricLiveStoreProvider,
  }
}
