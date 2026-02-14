/**
 * Shared module loading utility for CLI and MCP.
 * Loads and validates user config modules that export schema, syncBackend, and optional syncPayload.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { SyncBackend } from '@livestore/common'
import { UnknownError } from '@livestore/common'
import { isLiveStoreSchema, type LiveStoreSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'

export interface ModuleConfig {
  schema: LiveStoreSchema
  syncBackendConstructor: SyncBackend.SyncBackendConstructor
  syncPayloadSchema: Schema.Schema<any>
  syncPayload: unknown
}

/**
 * Loads and validates a user config module.
 * The module must export:
 * - `schema`: A valid LiveStore schema
 * - `syncBackend`: A sync backend constructor function
 * - `syncPayloadSchema` (optional): Schema for validating syncPayload
 * - `syncPayload` (optional): Payload data for the sync backend
 */
export const loadModuleConfig = ({
  configPath,
}: {
  configPath: string
}): Effect.Effect<ModuleConfig, UnknownError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const abs = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath)

    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(abs).pipe(UnknownError.mapToUnknownError)
    if (!exists) {
      return yield* UnknownError.make({
        cause: `Store module not found at ${abs}`,
        note: 'Make sure the path points to a valid LiveStore module',
      })
    }

    const mod = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(abs).href),
      catch: (cause) =>
        UnknownError.make({
          cause,
          note: `Failed to import module at ${abs}`,
        }),
    })

    const schema = (mod)?.schema
    if (!isLiveStoreSchema(schema)) {
      return yield* UnknownError.make({
        cause: `Module at ${abs} must export a valid LiveStore 'schema'`,
        note: `Ex: export { schema } from './src/livestore/schema.ts'`,
      })
    }

    const syncBackendConstructor = (mod)?.syncBackend
    if (typeof syncBackendConstructor !== 'function') {
      return yield* UnknownError.make({
        cause: `Module at ${abs} must export a 'syncBackend' constructor`,
        note: `Ex: export const syncBackend = makeWsSync({ url })`,
      })
    }

    const syncPayloadSchemaExport = (mod)?.syncPayloadSchema
    const syncPayloadSchema =
      syncPayloadSchemaExport === undefined
        ? Schema.JsonValue
        : Schema.isSchema(syncPayloadSchemaExport)
          ? (syncPayloadSchemaExport as Schema.Schema<any>)
          : shouldNeverHappen(
              `Exported 'syncPayloadSchema' from ${abs} must be an Effect Schema (received ${typeof syncPayloadSchemaExport}).`,
            )

    const syncPayloadExport = (mod)?.syncPayload
    const syncPayload = yield* (
      syncPayloadExport === undefined
        ? Effect.succeed<unknown>(undefined)
        : Schema.decodeUnknown(syncPayloadSchema)(syncPayloadExport)
    ).pipe(UnknownError.mapToUnknownError)

    return {
      schema,
      syncBackendConstructor,
      syncPayloadSchema,
      syncPayload,
    }
  }).pipe(Effect.withSpan('module-loader:loadModuleConfig'))
