import path from 'node:path'
import type { UnknownError } from '@livestore/common'
import { Console, Effect, FileSystem, type HttpClient, type Scope } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import * as SyncOps from '../sync-operations.ts'

/**
 * Export events from the sync backend to a JSON file.
 */
const exportEvents = ({
  configPath,
  storeId,
  clientId,
  outputPath,
}: {
  configPath: string
  storeId: string
  clientId: string
  outputPath: string
}): Effect.Effect<
  void,
  SyncOps.ExportError | SyncOps.ConnectionError | UnknownError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Console.log(`Connecting to sync backend...`)

    const result = yield* SyncOps.pullEventsFromSyncBackend({ configPath, storeId, clientId })

    yield* Console.log(`✓ Connected to sync backend`)
    yield* Console.log(`Pulled ${result.eventCount} events`)

    const fs = yield* FileSystem.FileSystem
    const absOutputPath = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath)

    yield* fs.writeFileString(absOutputPath, JSON.stringify(result.data, null, 2)).pipe(
      Effect.mapError(
        (cause) =>
          new SyncOps.ExportError({
            cause,
            note: `Failed to write export file: ${cause}`,
          }),
      ),
    )

    yield* Console.log(`Exported ${result.eventCount} events to ${absOutputPath}`)
  }).pipe(Effect.withSpan('cli:export'))

/**
 * Import events from a JSON file to the sync backend.
 */
const importEvents = ({
  configPath,
  storeId,
  clientId,
  inputPath,
  force,
  dryRun,
}: {
  configPath: string
  storeId: string
  clientId: string
  inputPath: string
  force: boolean
  dryRun: boolean
}): Effect.Effect<
  void,
  SyncOps.ImportError | SyncOps.ConnectionError | UnknownError,
  FileSystem.FileSystem | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const absInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)

    const exists = yield* fs.exists(absInputPath).pipe(
      Effect.mapError(
        (cause) =>
          new SyncOps.ImportError({
            cause,
            note: `Failed to check file existence: ${cause}`,
          }),
      ),
    )
    if (!exists) {
      return yield* new SyncOps.ImportError({
        cause: new Error(`File not found: ${absInputPath}`),
        note: `Import file does not exist at ${absInputPath}`,
      })
    }

    yield* Console.log(`Reading import file...`)

    const fileContent = yield* fs.readFileString(absInputPath).pipe(
      Effect.mapError(
        (cause) =>
          new SyncOps.ImportError({
            cause,
            note: `Failed to read import file: ${cause}`,
          }),
      ),
    )

    const parsedContent = yield* Effect.try({
      try: () => JSON.parse(fileContent),
      catch: (error) =>
        new SyncOps.ImportError({
          cause: new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`),
          note: `Invalid JSON in import file: ${error instanceof Error ? error.message : String(error)}`,
        }),
    })

    /** Validate export file format before proceeding */
    const validation = yield* SyncOps.validateExportData({ data: parsedContent, targetStoreId: storeId })

    if (validation.storeIdMismatch) {
      if (!force) {
        return yield* new SyncOps.ImportError({
          cause: new Error(`Store ID mismatch: file has '${validation.sourceStoreId}', expected '${storeId}'`),
          note: `The export file was created for a different store. Use --force to import anyway.`,
        })
      }
      yield* Console.log(
        `Store ID mismatch: file has '${validation.sourceStoreId}', importing to '${storeId}' (--force)`,
      )
    }

    yield* Console.log(`Found ${validation.eventCount} events in export file`)

    if (dryRun) {
      yield* Console.log(`Dry run - validating import file...`)
      yield* Console.log(`Dry run complete. ${validation.eventCount} events would be imported.`)
      return
    }

    yield* Console.log(`Connecting to sync backend...`)

    const result = yield* SyncOps.pushEventsToSyncBackend({
      configPath,
      storeId,
      clientId,
      data: parsedContent,
      force,
      dryRun: false,
    })

    yield* Console.log(`✓ Connected to sync backend`)
    yield* Console.log(`Successfully imported ${result.eventCount} events`)
  }).pipe(Effect.withSpan('cli:import'))

export const exportCommand = Cli.Command.make(
  'export',
  {
    config: Cli.Options.text('config').pipe(
      Cli.Options.withAlias('c'),
      Cli.Options.withDescription('Path to the config module that exports schema and syncBackend'),
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
    config,
    storeId,
    clientId,
    output,
  }: {
    config: string
    storeId: string
    clientId: string
    output: string
  }) {
    yield* Console.log(`Exporting events from LiveStore...`)
    yield* Console.log(`   Config: ${config}`)
    yield* Console.log(`   Store ID: ${storeId}`)
    yield* Console.log(`   Output: ${output}`)
    yield* Console.log('')

    yield* exportEvents({
      configPath: config,
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
    config: Cli.Options.text('config').pipe(
      Cli.Options.withAlias('c'),
      Cli.Options.withDescription('Path to the config module that exports schema and syncBackend'),
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
    config,
    storeId,
    clientId,
    force,
    dryRun,
    input,
  }: {
    config: string
    storeId: string
    clientId: string
    force: boolean
    dryRun: boolean
    input: string
  }) {
    yield* Console.log(`Importing events to LiveStore...`)
    yield* Console.log(`   Config: ${config}`)
    yield* Console.log(`   Store ID: ${storeId}`)
    yield* Console.log(`   Input: ${input}`)
    if (force) yield* Console.log(`   Force: enabled`)
    if (dryRun) yield* Console.log(`   Dry run: enabled`)
    yield* Console.log('')

    yield* importEvents({
      configPath: config,
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
