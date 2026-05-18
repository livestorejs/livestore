// Minimal React Native stubs for Twoslash type-checking
import type * as React from 'react'

declare module 'react-native' {
  export const View: React.ComponentType<any>
  export const Text: React.ComponentType<any>
  export const TextInput: React.ComponentType<any>
  export const Button: React.ComponentType<any>
  export const SafeAreaView: React.ComponentType<any>
  export const ScrollView: React.ComponentType<any>
  export const StyleSheet: { create<T extends Record<string, any>>(styles: T): T }
  export const TouchableOpacity: React.ComponentType<any>
  export const TouchableWithoutFeedback: React.ComponentType<any>
  export const Keyboard: { dismiss(): void }
  export const unstable_batchedUpdates: (fn: () => void) => void
}

declare module 'expo-status-bar' {
  export const StatusBar: React.ComponentType<{ style?: 'auto' | 'light' | 'dark' }>
}

declare module 'expo-application' {
  export function getAndroidId(): string | null
  export function getIosIdForVendorAsync(): Promise<string | null>
}

declare module 'expo-sqlite' {
  type DatabaseOptions = { useNewConnection?: boolean }
  type DatabaseLocation = string

  export type SQLiteRunResult = {
    resetSync(): void
    getAllSync<T = unknown>(): T[]
    changes: number
  }

  export type SQLiteStatement = {
    executeSync(parameters?: unknown[]): SQLiteRunResult
    finalizeSync(): void
  }

  export type SQLiteSession = {
    attachSync(databaseName: string | null): void
    createChangesetSync(): ArrayBuffer
    invertChangesetSync(data: ArrayBuffer): ArrayBuffer
    applyChangesetSync(data: ArrayBuffer): void
    closeSync(): void
  }

  export type SQLiteDatabase = {
    prepareSync(source: string): SQLiteStatement
    serializeSync(): ArrayBuffer
    closeSync(): void
    createSessionSync(): SQLiteSession
  }

  export function openDatabaseSync(
    name: string,
    options?: DatabaseOptions,
    directory?: DatabaseLocation,
  ): SQLiteDatabase
  export function deleteDatabaseSync(name: string, directory?: DatabaseLocation): void
  export function deserializeDatabaseSync(data: ArrayBuffer | Uint8Array): SQLiteDatabase
  export function backupDatabaseSync(options: { sourceDatabase: SQLiteDatabase; destDatabase: SQLiteDatabase }): void
  export const defaultDatabaseDirectory: string
}
