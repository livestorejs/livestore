import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SyncBackend } from '@livestore/common'
import { UnknownError } from '@livestore/common'
import { isLiveStoreSchema, LiveStoreEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import {
  Cause,
  Console,
  Effect,
  FileSystem,
  type HttpClient,
  KeyValueStore,
  Layer,
  Option,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

/** Connection timeout for sync backend ping (5 seconds) */
const CONNECTION_TIMEOUT_MS = 5000

/**
 * Schema for the export file format.
 * Contains metadata about the export and an array of events in global encoded format.
 */
const ExportFileSchema = Schema.Struct({
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

type ExportFile = typeof ExportFileSchema.Type

class ConnectionError extends Schema.TaggedError<ConnectionError>()('ConnectionError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

class ExportError extends Schema.TaggedError<ExportError>()('ExportError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

class ImportError extends Schema.TaggedError<ImportError>()('ImportError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

/**
 * Creates a sync backend connection from a user module and verifies connectivity.
 * This is a simplified version of the MCP runtime that only creates the sync backend.
 */
const makeSyncBackend = ({
  storePath,
  storeId,
  clientId,
}: {
  storePath: string
  storeId: string
  clientId: string
}): Effect.Effect<
  SyncBackend.SyncBackend,
  UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const abs = path.isAbsolute(storePath) ? storePath : path.resolve(process.cwd(), storePath)

    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(abs).pipe(UnknownError.mapToUnknownError)
    if (!exists) {
      return yield* Effect.fail(
        UnknownError.make({
          cause: `Store module not found at ${abs}`,
          note: 'Make sure the path points to a valid LiveStore module',
        }),
      )
    }

    const mod = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(abs).href),
      catch: (cause) =>
        UnknownError.make({
          cause,
          note: `Failed to import module at ${abs}`,
        }),
    })

    const schema = (mod as any)?.schema
    if (!isLiveStoreSchema(schema)) {
      return yield* Effect.fail(
        UnknownError.make({
          cause: `Module at ${abs} must export a valid LiveStore 'schema'`,
          note: `Ex: export { schema } from './src/livestore/schema.ts'`,
        }),
      )
    }

    const syncBackendConstructor = (mod as any)?.syncBackend
    if (typeof syncBackendConstructor !== 'function') {
      return yield* Effect.fail(
        UnknownError.make({
          cause: `Module at ${abs} must export a 'syncBackend' constructor`,
          note: `Ex: export const syncBackend = makeWsSync({ url })`,
        }),
      )
    }

    const syncPayloadSchemaExport = (mod as any)?.syncPayloadSchema
    const syncPayloadSchema =
      syncPayloadSchemaExport === undefined
        ? Schema.JsonValue
        : Schema.isSchema(syncPayloadSchemaExport)
          ? (syncPayloadSchemaExport as Schema.Schema<any>)
          : shouldNeverHappen(
              `Exported 'syncPayloadSchema' from ${abs} must be an Effect Schema (received ${typeof syncPayloadSchemaExport}).`,
            )

    const syncPayloadExport = (mod as any)?.syncPayload
    const syncPayload = yield* (
      syncPayloadExport === undefined
        ? Effect.succeed<unknown>(undefined)
        : Schema.decodeUnknown(syncPayloadSchema)(syncPayloadExport)
    ).pipe(UnknownError.mapToUnknownError)

    /** Simple in-memory key-value store for sync backend state */
    const kvStore: { backendId: string | undefined } = { backendId: undefined }

    const syncBackend = yield* (syncBackendConstructor as SyncBackend.SyncBackendConstructor)({
      storeId,
      clientId,
      payload: syncPayload,
    }).pipe(
      Effect.provide(
        Layer.succeed(
          KeyValueStore.KeyValueStore,
          KeyValueStore.makeStringOnly({
            get: (_key) => Effect.succeed(Option.fromNullable(kvStore.backendId)),
            set: (_key, value) =>
              Effect.sync(() => {
                kvStore.backendId = value
              }),
            clear: Effect.dieMessage('Not implemented'),
            remove: () => Effect.dieMessage('Not implemented'),
            size: Effect.dieMessage('Not implemented'),
          }),
        ),
      ),
      UnknownError.mapToUnknownError,
    )

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

    yield* Console.log(`✓ Connected to sync backend: ${syncBackend.metadata.name}`)

    return syncBackend
  })

/**
 * Export events from the sync backend to a JSON file.
 */
const exportEvents = ({
  storePath,
  storeId,
  clientId,
  outputPath,
}: {
  storePath: string
  storeId: string
  clientId: string
  outputPath: string
}): Effect.Effect<
  void,
  ExportError | UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Console.log(`Connecting to sync backend...`)

    const syncBackend = yield* makeSyncBackend({ storePath, storeId, clientId })

    yield* Console.log(`Pulling events from sync backend...`)

    const events: LiveStoreEvent.Global.Encoded[] = []

    yield* syncBackend.pull(Option.none(), { live: false }).pipe(
      Stream.tap((item) =>
        Effect.sync(() => {
          for (const { eventEncoded } of item.batch) {
            events.push(eventEncoded)
          }
        }),
      ),
      Stream.takeUntil((item) => item.pageInfo._tag === 'NoMore'),
      Stream.runDrain,
      Effect.mapError(
        (cause) =>
          new ExportError({
            cause,
            note: `Failed to pull events from sync backend: ${cause}`,
          }),
      ),
    )

    yield* Console.log(`Pulled ${events.length} events`)

    const exportData: ExportFile = {
      version: 1,
      storeId,
      exportedAt: new Date().toISOString(),
      eventCount: events.length,
      events,
    }

    const fs = yield* FileSystem.FileSystem
    const absOutputPath = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath)

    yield* fs.writeFileString(absOutputPath, JSON.stringify(exportData, null, 2)).pipe(
      Effect.mapError(
        (cause) =>
          new ExportError({
            cause,
            note: `Failed to write export file: ${cause}`,
          }),
      ),
    )

    yield* Console.log(`Exported ${events.length} events to ${absOutputPath}`)
  }).pipe(Effect.withSpan('cli:export'))

/**
 * Import events from a JSON file to the sync backend.
 */
const importEvents = ({
  storePath,
  storeId,
  clientId,
  inputPath,
  force,
  dryRun,
}: {
  storePath: string
  storeId: string
  clientId: string
  inputPath: string
  force: boolean
  dryRun: boolean
}): Effect.Effect<
  void,
  ImportError | UnknownError | ConnectionError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const absInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)

    const exists = yield* fs.exists(absInputPath).pipe(UnknownError.mapToUnknownError)
    if (!exists) {
      return yield* Effect.fail(
        new ImportError({
          cause: new Error(`File not found: ${absInputPath}`),
          note: `Import file does not exist at ${absInputPath}`,
        }),
      )
    }

    yield* Console.log(`Reading import file...`)

    const fileContent = yield* fs.readFileString(absInputPath).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause,
            note: `Failed to read import file: ${cause}`,
          }),
      ),
    )

    const parsedContent = yield* Effect.try({
      try: () => JSON.parse(fileContent),
      catch: (error) =>
        new ImportError({
          cause: new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`),
          note: `Invalid JSON in import file: ${error instanceof Error ? error.message : String(error)}`,
        }),
    })

    const exportData = yield* Schema.decodeUnknown(ExportFileSchema)(parsedContent).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause: new Error(`Invalid export file format: ${cause}`),
            note: `Invalid export file format: ${cause}`,
          }),
      ),
    )

    if (exportData.storeId !== storeId) {
      if (!force) {
        return yield* Effect.fail(
          new ImportError({
            cause: new Error(`Store ID mismatch: file has '${exportData.storeId}', expected '${storeId}'`),
            note: `The export file was created for a different store. Use --force to import anyway.`,
          }),
        )
      }
      yield* Console.log(`Store ID mismatch: file has '${exportData.storeId}', importing to '${storeId}' (--force)`)
    }

    yield* Console.log(`Found ${exportData.events.length} events in export file`)

    if (dryRun) {
      yield* Console.log(`Dry run - validating import file...`)
      yield* Console.log(`Dry run complete. ${exportData.events.length} events would be imported.`)
      return
    }

    yield* Console.log(`Connecting to sync backend...`)

    const syncBackend = yield* makeSyncBackend({ storePath, storeId, clientId })

    /** Check if events already exist by pulling from the backend first */
    yield* Console.log(`Checking for existing events...`)

    let existingEventCount = 0
    yield* syncBackend.pull(Option.none(), { live: false }).pipe(
      Stream.tap((item) =>
        Effect.sync(() => {
          existingEventCount += item.batch.length
        }),
      ),
      Stream.takeUntil((item) => item.pageInfo._tag === 'NoMore'),
      Stream.runDrain,
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause,
            note: `Failed to check existing events: ${cause}`,
          }),
      ),
    )

    if (existingEventCount > 0) {
      return yield* Effect.fail(
        new ImportError({
          cause: new Error(`Sync backend already contains ${existingEventCount} events`),
          note: `Cannot import into a non-empty sync backend. The sync backend must be empty.`,
        }),
      )
    }

    yield* Console.log(`Pushing ${exportData.events.length} events to sync backend...`)

    /** Push events in batches of 100 (sync backend constraint) */
    const batchSize = 100
    let pushed = 0

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

      pushed += batch.length
      yield* Console.log(`  Pushed ${pushed}/${exportData.events.length} events`)
    }

    yield* Console.log(`Successfully imported ${exportData.events.length} events`)
  }).pipe(Effect.withSpan('cli:import'))

export const exportCommand = Cli.Command.make(
  'export',
  {
    store: Cli.Options.text('store').pipe(
      Cli.Options.withAlias('s'),
      Cli.Options.withDescription('Path to the store module that exports schema and syncBackend'),
    ),
    storeId: Cli.Options.text('store-id').pipe(
      Cli.Options.withAlias('i'),
      Cli.Options.withDescription('Store identifier'),
    ),
    clientId: Cli.Options.text('client-id').pipe(
      Cli.Options.withDefault('cli-export'),
      Cli.Options.withDescription('Client identifier for the sync connection'),
    ),
    output: Cli.Args.text({ name: 'file' }).pipe(Cli.Args.withDescription('Output JSON file path')),
  },
  Effect.fn(function* ({
    store,
    storeId,
    clientId,
    output,
  }: {
    store: string
    storeId: string
    clientId: string
    output: string
  }) {
    yield* Console.log(`Exporting events from LiveStore...`)
    yield* Console.log(`   Store: ${store}`)
    yield* Console.log(`   Store ID: ${storeId}`)
    yield* Console.log(`   Output: ${output}`)
    yield* Console.log('')

    yield* exportEvents({
      storePath: store,
      storeId,
      clientId,
      outputPath: output,
    }).pipe(Effect.scoped)
  }),
).pipe(
  Cli.Command.withDescription(
    'Export all events from the sync backend to a JSON file. Useful for backup and migration.',
  ),
)

export const importCommand = Cli.Command.make(
  'import',
  {
    store: Cli.Options.text('store').pipe(
      Cli.Options.withAlias('s'),
      Cli.Options.withDescription('Path to the store module that exports schema and syncBackend'),
    ),
    storeId: Cli.Options.text('store-id').pipe(
      Cli.Options.withAlias('i'),
      Cli.Options.withDescription('Store identifier'),
    ),
    clientId: Cli.Options.text('client-id').pipe(
      Cli.Options.withDefault('cli-import'),
      Cli.Options.withDescription('Client identifier for the sync connection'),
    ),
    force: Cli.Options.boolean('force').pipe(
      Cli.Options.withAlias('f'),
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Force import even if store ID does not match'),
    ),
    dryRun: Cli.Options.boolean('dry-run').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Validate the import file without actually importing'),
    ),
    input: Cli.Args.text({ name: 'file' }).pipe(Cli.Args.withDescription('Input JSON file to import')),
  },
  Effect.fn(function* ({
    store,
    storeId,
    clientId,
    force,
    dryRun,
    input,
  }: {
    store: string
    storeId: string
    clientId: string
    force: boolean
    dryRun: boolean
    input: string
  }) {
    yield* Console.log(`Importing events to LiveStore...`)
    yield* Console.log(`   Store: ${store}`)
    yield* Console.log(`   Store ID: ${storeId}`)
    yield* Console.log(`   Input: ${input}`)
    if (force) yield* Console.log(`   Force: enabled`)
    if (dryRun) yield* Console.log(`   Dry run: enabled`)
    yield* Console.log('')

    yield* importEvents({
      storePath: store,
      storeId,
      clientId,
      inputPath: input,
      force,
      dryRun,
    }).pipe(Effect.scoped)
  }),
).pipe(
  Cli.Command.withDescription('Import events from a JSON file to the sync backend. The sync backend must be empty.'),
)

export const syncCommand = Cli.Command.make('sync').pipe(
  Cli.Command.withSubcommands([exportCommand, importCommand]),
  Cli.Command.withDescription('Import and export events from the sync backend'),
)
