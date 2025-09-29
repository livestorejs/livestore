import type { LiveStoreSchema } from '@livestore/common/schema'
import type { FC, ReactNode } from 'react'
import React, { useContext, useEffect, useRef } from 'react'
import { LiveStoreProvider } from '../LiveStoreProvider.js'
import { useStore as useStoreOriginal } from '../useStore.js'
import type {
  ComputeProviderProps,
  CreateStoreContextConfig,
  CreateStoreContextReturn,
  StoreWithReactAPI,
  UseStoreOptions,
} from './types.js'

// ============================================
// Main Implementation
// ============================================

export function createStoreContext<
  TSchema extends LiveStoreSchema,
  const TConfig extends CreateStoreContextConfig<TSchema>,
>(config: TConfig): CreateStoreContextReturn<TSchema, TConfig> {
  // Create a context for multi-instance registry
  const RegistryContext = React.createContext<Map<string, StoreWithReactAPI<TSchema>> | undefined>(undefined)
  RegistryContext.displayName = `${config.name}RegistryContext`

  // ============================================
  // Provider Component
  // ============================================

  const Provider: FC<ComputeProviderProps<TConfig>> = (props) => {
    // Registry for multi-instance support
    const registryRef = useRef<Map<string, StoreWithReactAPI<TSchema>>>(new Map())

    // Merge config with props - props take precedence
    const mergedProps = {
      ...config,
      ...props,
      // Ensure required values from either config or props
      schema: config.schema, // Schema always from config
      adapter: (props as any).adapter ?? config.adapter,
      batchUpdates: (props as any).batchUpdates ?? config.batchUpdates,
      storeId: (props as any).storeId ?? config.name,
    }

    // Validate required props at runtime (development only)
    if (process.env.NODE_ENV !== 'production') {
      if (!mergedProps.adapter) {
        throw new Error(
          `${config.name} Provider: adapter is required. Provide it either in createStoreContext or as a prop to the Provider.`,
        )
      }
      if (!mergedProps.batchUpdates) {
        throw new Error(
          `${config.name} Provider: batchUpdates is required. Provide it either in createStoreContext or as a prop to the Provider.`,
        )
      }
    }

    // Create a wrapper component that uses LiveStoreProvider
    return (
      <RegistryContext.Provider value={registryRef.current}>
        <LiveStoreProvider
          schema={mergedProps.schema}
          adapter={mergedProps.adapter}
          batchUpdates={mergedProps.batchUpdates}
          storeId={mergedProps.storeId}
          disableDevtools={mergedProps.disableDevtools}
          confirmUnsavedChanges={mergedProps.confirmUnsavedChanges}
          syncPayload={mergedProps.syncPayload}
          renderLoading={() => null} // Always render children for Suspense
          renderError={(error) => {
            throw error
          }} // Throw for Error Boundaries
          renderShutdown={() => null}
        >
          <StoreRegistrar storeId={mergedProps.storeId} registry={registryRef.current}>
            {props.children}
          </StoreRegistrar>
        </LiveStoreProvider>
      </RegistryContext.Provider>
    )
  }

  // Helper component to register store in the registry
  const StoreRegistrar: FC<{
    children: ReactNode
    storeId: string
    registry: Map<string, StoreWithReactAPI<TSchema>>
  }> = ({ children, storeId, registry }) => {
    const { store } = useStoreOriginal() as { store: StoreWithReactAPI<TSchema> }

    // Register this store instance
    useEffect(() => {
      registry.set(storeId, store)
      return () => {
        registry.delete(storeId)
      }
    }, [storeId, store, registry])

    return <>{children}</>
  }

  Provider.displayName = `${config.name}StoreProvider`

  // ============================================
  // useStore Hook
  // ============================================

  const useStore = (options?: UseStoreOptions): StoreWithReactAPI<TSchema> => {
    const registry = useContext(RegistryContext)

    // Always call the hook (React hooks rules)
    const storeResult = useStoreOriginal()

    // Multi-instance access via storeId
    if (options?.storeId) {
      if (!registry) {
        throw new Error(
          `Multi-instance access requires the store to be created with createStoreContext. ` +
            `Cannot access store with storeId="${options.storeId}".`,
        )
      }

      const targetStoreId = options.storeId // Capture it for closure
      const store = registry.get(targetStoreId)
      if (!store) {
        // Store might still be loading - throw a promise for Suspense
        throw new Promise<void>((resolve) => {
          // Check periodically if the store is available
          const checkInterval = setInterval(() => {
            if (registry.get(targetStoreId)) {
              clearInterval(checkInterval)
              resolve()
            }
          }, 10)

          // Timeout after 5 seconds
          setTimeout(() => {
            clearInterval(checkInterval)
            throw new Error(
              `Store instance "${targetStoreId}" not found after timeout. ` +
                `Make sure a ${config.name} Provider with storeId="${targetStoreId}" exists.`,
            )
          }, 5000)
        })
      }

      return store
    }

    // Default: use the standard store from the hook we already called
    if (!storeResult) {
      throw new Error(
        `useStore: must be used within a ${config.name} Provider. ` +
          `Wrap your component tree with <${config.name}Provider> to provide the store context.`,
      )
    }

    const { store } = storeResult as { store: StoreWithReactAPI<TSchema> }
    return store
  }

  // Return the tuple
  return [Provider, useStore]
}
