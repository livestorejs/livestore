/**
 * Shared sync operations for CLI and MCP.
 * Contains the core logic for exporting and importing events from sync backends.
 */
import type { SyncBackend } from '@livestore/common'
import { UnknownError } from '@livestore/common'
import { LiveStoreEvent } from '@livestore/common/schema'
import {
  Cause,
  Chunk,
  Effect,
  type FileSystem,
  type HttpClient,
  KeyValueStore,
  Option,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

import { loadModuleConfig } from './module-loader.ts'

/** Connection timeout for sync backend ping (5 seconds) */
const CONNECTION_TIMEOUT_MS = 5000

/**
 * Schema for the export file format.
 * Contains metadata about the export and an array of events in global encoded format.
 */
export const ExportFileSchema = Schema.Struct({
  /** Format version for future compatibility */
  version: Schema.Literal(1),
  /** Store identifier */
  storeId: Schema.String,
  /** ISO timestamp of when the export was created */
  exportedAt: Schema.String,
  /** Total number of events in the export */
  eventCount: Schema.Number,
  /** Array of events in global encoded format */
  events: Schema.Array(LiveStoreEvent.Global.Encoded),
})

export type ExportFile = typeof ExportFileSchema.Type

export class ConnectionError extends Schema.TaggedError<ConnectionError>()('ConnectionError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

export class ExportError extends Schema.TaggedError<ExportError>()('ExportError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

export class ImportError extends Schema.TaggedError<ImportError>()('ImportError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

/**
 * Creates a sync backend connection from a user module and verifies connectivity.
 * This is a simplified version of the MCP runtime that only creates the sync backend.
 */
export const makeSyncBackend = ({
  configPath,
  storeId,
  clientId,
}: {
  /** Absolute or cwd-relative path to a module exporting `schema` and `syncBackend`. */
  configPath: string
  /** Identifier to scope the backend connection. */
  storeId: string
  /** Client identifier used when establishing the sync connection. */
  clientId: string
}): Effect.Effect<
  SyncBackend.SyncBackend,
  UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const { syncBackendConstructor, syncPayload } = yield* loadModuleConfig({ configPath })

    const syncBackend = yield* (syncBackendConstructor as SyncBackend.SyncBackendConstructor)({
      storeId,
      clientId,
      /** syncPayload is validated against syncPayloadSchema by loadModuleConfig */
      payload: syncPayload as Schema.JsonValue | undefined,
    }).pipe(Effect.provide(KeyValueStore.layerMemory), UnknownError.mapToUnknownError)

    /** Connect to the sync backend */
    yield* syncBackend.connect.pipe(
      Effect.mapError(
        (cause) =>
          new ConnectionError({
            cause,
            note: `Failed to connect to sync backend: ${cause._tag === 'IsOfflineError' ? 'Backend is offline or unreachable' : String(cause)}`,
          }),
      ),
    )

    /** Verify connectivity with a ping (with timeout) */
    yield* syncBackend.ping.pipe(
      Effect.timeout(CONNECTION_TIMEOUT_MS),
      Effect.catchAll((cause) => {
        if (Cause.isTimeoutException(cause)) {
          return Effect.fail(
            new ConnectionError({
              cause,
              note: `Connection timeout: Sync backend did not respond within ${CONNECTION_TIMEOUT_MS}ms`,
            }),
          )
        }
        return Effect.fail(
          new ConnectionError({
            cause,
            note: `Failed to ping sync backend: ${cause._tag === 'IsOfflineError' ? 'Backend is offline or unreachable' : String(cause)}`,
          }),
        )
      }),
    )

    return syncBackend
  })

export interface ExportResult {
  storeId: string
  eventCount: number
  exportedAt: string
  /** The export data as JSON string (for MCP) or written to file (for CLI) */
  data: ExportFile
}

/**
 * Core export operation - pulls all events from sync backend.
 * Returns the export data structure without writing to file.
 */
export const pullEventsFromSyncBackend = ({
  configPath,
  storeId,
  clientId,
}: {
  configPath: string
  storeId: string
  clientId: string
}): Effect.Effect<
  ExportResult,
  ExportError | UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const syncBackend = yield* makeSyncBackend({ configPath, storeId, clientId })

    const batchesChunk = yield* syncBackend.pull(Option.none(), { live: false }).pipe(
      Stream.takeUntil((item) => item.pageInfo._tag === 'NoMore'),
      Stream.runCollect,
      Effect.mapError(
        (cause) =>
          new ExportError({
            cause,
            note: `Failed to pull events from sync backend: ${cause}`,
          }),
      ),
    )

    const events = Chunk.toReadonlyArray(batchesChunk)
      .flatMap((item) => item.batch)
      .map((item) => item.eventEncoded)

    const exportedAt = new Date().toISOString()
    const exportData: ExportFile = {
      version: 1,
      storeId,
      exportedAt,
      eventCount: events.length,
      events,
    }

    return {
      storeId,
      eventCount: events.length,
      exportedAt,
      data: exportData,
    }
  }).pipe(Effect.withSpan('sync:pullEvents'))

export interface ImportResult {
  storeId: string
  eventCount: number
  /** Whether this was a dry run */
  dryRun: boolean
}

export interface ImportValidationResult {
  storeId: string
  eventCount: number
  sourceStoreId: string
  storeIdMismatch: boolean
}

/**
 * Validates an export file for import.
 * Returns validation info without actually importing.
 */
export const validateExportData = ({
  data,
  targetStoreId,
}: {
  data: unknown
  targetStoreId: string
}): Effect.Effect<ImportValidationResult, ImportError> =>
  Effect.gen(function* () {
    const exportData = yield* Schema.decodeUnknown(ExportFileSchema)(data).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause: new Error(`Invalid export file format: ${cause}`),
            note: `Invalid export file format: ${cause}`,
          }),
      ),
    )

    return {
      storeId: targetStoreId,
      eventCount: exportData.events.length,
      sourceStoreId: exportData.storeId,
      storeIdMismatch: exportData.storeId !== targetStoreId,
    }
  })

/**
 * Core import operation - pushes events to sync backend.
 * Validates that the backend is empty before importing.
 */
export const pushEventsToSyncBackend = ({
  configPath,
  storeId,
  clientId,
  data,
  force,
  dryRun,
}: {
  configPath: string
  storeId: string
  clientId: string
  /** The export data to import (already parsed) */
  data: unknown
  force: boolean
  dryRun: boolean
}): Effect.Effect<
  ImportResult,
  ImportError | UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const exportData = yield* Schema.decodeUnknown(ExportFileSchema)(data).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause: new Error(`Invalid export file format: ${cause}`),
            note: `Invalid export file format: ${cause}`,
          }),
      ),
    )

    if (exportData.storeId !== storeId && !force) {
      return yield* new ImportError({
        cause: new Error(`Store ID mismatch: file has '${exportData.storeId}', expected '${storeId}'`),
        note: `The export file was created for a different store. Use force option to import anyway.`,
      })
    }

    if (dryRun) {
      return {
        storeId,
        eventCount: exportData.events.length,
        dryRun: true,
      }
    }

    const syncBackend = yield* makeSyncBackend({ configPath, storeId, clientId })

    /** Check if events already exist by pulling from the backend first */
    const existingBatchesChunk = yield* syncBackend.pull(Option.none(), { live: false }).pipe(
      Stream.takeUntil((item) => item.pageInfo._tag === 'NoMore'),
      Stream.runCollect,
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause,
            note: `Failed to check existing events: ${cause}`,
          }),
      ),
    )

    const existingEventCount = Chunk.reduce(existingBatchesChunk, 0, (acc, item) => acc + item.batch.length)

    if (existingEventCount > 0) {
      return yield* new ImportError({
        cause: new Error(`Sync backend already contains ${existingEventCount} events`),
        note: `Cannot import into a non-empty sync backend. The sync backend must be empty.`,
      })
    }

    /** Push events in batches of 100 (sync backend constraint) */
    const batchSize = 100

    for (let i = 0; i < exportData.events.length; i += batchSize) {
      const batch = exportData.events.slice(i, i + batchSize)

      yield* syncBackend.push(batch).pipe(
        Effect.mapError(
          (cause) =>
            new ImportError({
              cause,
              note: `Failed to push events at position ${i}: ${cause}`,
            }),
        ),
      )
    }

    return {
      storeId,
      eventCount: exportData.events.length,
      dryRun: false,
    }
  }).pipe(Effect.withSpan('sync:pushEvents'))
