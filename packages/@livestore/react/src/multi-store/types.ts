import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import type { Schema } from '@livestore/utils/effect'
import type { FC, ReactNode } from 'react'

// ============================================
// Core Types
// ============================================

// Configuration that can be provided to createStoreContext
export interface CreateStoreContextConfig<TSchema extends LiveStoreSchema> {
  name: string
  schema: TSchema
  adapter?: Adapter
  batchUpdates?: (fn: () => void) => void
  disableDevtools?: boolean
  confirmUnsavedChanges?: boolean
  syncPayload?: Schema.JsonValue
  // TODO: Add otelOptions when needed
}

// All possible Provider props
export interface BaseProviderProps {
  children: ReactNode
  storeId?: string
  adapter?: Adapter
  batchUpdates?: (fn: () => void) => void
  disableDevtools?: boolean
  confirmUnsavedChanges?: boolean
  syncPayload?: Schema.JsonValue
}

// ============================================
// Type-Level Computation (Simplified)
// ============================================

// Define props that can be configured either at createStoreContext or Provider level
type ConfigurableProps = {
  adapter: Adapter
  batchUpdates: (fn: () => void) => void
}

// Helper to extract props from config that have non-undefined values
type ProvidedConfigProps<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K]
}

// Compute which Provider props are required based on what was provided in config
// Props in config become optional (can override), props not in config are required
export type ComputeProviderProps<TConfig extends CreateStoreContextConfig<any>> = {
  children: ReactNode
  storeId?: string
  disableDevtools?: boolean
  confirmUnsavedChanges?: boolean
  syncPayload?: Schema.JsonValue
} & Omit<Required<ConfigurableProps>, keyof ProvidedConfigProps<TConfig>> &
  Partial<Pick<ConfigurableProps, keyof ProvidedConfigProps<TConfig> & keyof ConfigurableProps>>

// ============================================
// Store API Types
// ============================================

// React-specific methods added to the store
export type StoreReactAPI<_TSchema extends LiveStoreSchema> = {}

// Store with React API methods
export type StoreWithReactAPI<TSchema extends LiveStoreSchema> = Store<TSchema> & StoreReactAPI<TSchema>

// Options for useStore hook
export interface UseStoreOptions {
  storeId?: string
  syncPayload?: Schema.JsonValue
}

// ============================================
// Main Function Return Type
// ============================================

export type CreateStoreContextReturn<
  TSchema extends LiveStoreSchema,
  TConfig extends CreateStoreContextConfig<TSchema>,
> = [
  // Provider component with computed props
  FC<ComputeProviderProps<TConfig>>,
  // useStore hook
  (options?: UseStoreOptions) => StoreWithReactAPI<TSchema>,
]

// ============================================
// Main Function
// ============================================

// The actual implementation is in createStoreContext.tsx
// Import from there to use the function
