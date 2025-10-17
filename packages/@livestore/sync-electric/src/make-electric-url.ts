import { shouldNeverHappen } from '@livestore/utils'
import { Hash, Schema } from '@livestore/utils/effect'
import * as ApiSchema from './api-schema.ts'

/**
 * This function should be called in a trusted environment (e.g. a proxy server) as it
 * requires access to senstive information (e.g. `apiSecret` / `sourceSecret`).
 */
export const makeElectricUrl = ({
  electricHost,
  searchParams: providedSearchParams,
  sourceId,
  sourceSecret,
  apiSecret,
}: {
  electricHost: string
  /**
   * Needed to extract information from the search params which the `@livestore/sync-electric`
   * client implementation automatically adds:
   * - `handle`: the ElectricSQL handle
   * - `storeId`: the Livestore storeId
   */
  searchParams: URLSearchParams
  /** Needed for Electric Cloud */
  sourceId?: string
  /** Needed for Electric Cloud */
  sourceSecret?: string
  /** For self-hosted ElectricSQL */
  apiSecret?: string
}): {
  /**
   * The URL to the ElectricSQL API endpoint with needed search params.
   */
  url: string
  /** The Livestore storeId */
  storeId: string
  /**
   * Whether the Postgres table needs to be created.
   */
  needsInit: boolean
  /** Sync payload provided by the client */
  payload: Schema.JsonValue | undefined
} => {
  const endpointUrl = `${electricHost}/v1/shape`
  const UrlParamsSchema = Schema.Struct({ args: ApiSchema.ArgsSchema })
  const argsResult = Schema.decodeUnknownEither(UrlParamsSchema)(Object.fromEntries(providedSearchParams.entries()))

  if (argsResult._tag === 'Left') {
    return shouldNeverHappen(
      'Invalid search params provided to makeElectricUrl',
      providedSearchParams,
      Object.fromEntries(providedSearchParams.entries()),
    )
  }

  const args = argsResult.right.args
  const tableName = toTableName(args.storeId)
  // TODO refactor with Effect URLSearchParams schema
  // https://electric-sql.com/openapi.html
  const searchParams = new URLSearchParams()
  // Electric requires table names with capital letters to be quoted
  // Since our table names include the storeId which may have capitals, we always quote
  searchParams.set('table', `"${tableName}"`)
  if (sourceId !== undefined) {
    searchParams.set('source_id', sourceId)
  }
  if (sourceSecret !== undefined) {
    searchParams.set('source_secret', sourceSecret)
  }
  if (apiSecret !== undefined) {
    searchParams.set('api_secret', apiSecret)
  }
  if (args.handle._tag === 'None') {
    searchParams.set('offset', '-1')
  } else {
    searchParams.set('offset', args.handle.value.offset)
    searchParams.set('handle', args.handle.value.handle)
    searchParams.set('live', args.live ? 'true' : 'false')
  }

  const payload = args.payload

  const url = `${endpointUrl}?${searchParams.toString()}`

  return { url, storeId: args.storeId, needsInit: args.handle._tag === 'None', payload }
}

export const toTableName = (storeId: string) => {
  const escapedStoreId = storeId.replaceAll(/[^a-zA-Z0-9_]/g, '_')
  const tableName = `eventlog_${PERSISTENCE_FORMAT_VERSION}_${escapedStoreId}`

  if (tableName.length > 63) {
    const hashedStoreId = Hash.string(storeId)

    console.warn(
      `Table name is too long: "${tableName}". Postgres table names are limited to 63 characters. Using hashed storeId instead: "${hashedStoreId}".`,
    )

    return `eventlog_${PERSISTENCE_FORMAT_VERSION}_hash_${hashedStoreId}`
  }

  return tableName
}

/**
 * CRITICAL: Increment this version whenever you modify the Postgres table schema structure.
 *
 * Bump required when:
 * - Adding/removing/renaming columns in the eventlog table (see examples/web-todomvc-sync-electric/src/server/db.ts)
 * - Changing column types or constraints
 * - Modifying primary keys or indexes
 *
 * Bump NOT required when:
 * - Changing query patterns or fetch logic
 * - Adding new tables (as long as existing table schema remains unchanged)
 * - Updating client-side implementation details
 *
 * Impact: Changing this version triggers a "soft reset" - new table names are created
 * and old data becomes inaccessible (but remains in the database).
 *
 * Current schema (PostgreSQL):
 * - seqNum (INTEGER PRIMARY KEY)
 * - parentSeqNum (INTEGER)
 * - name (TEXT NOT NULL)
 * - args (JSONB NOT NULL)
 * - clientId (TEXT NOT NULL)
 * - sessionId (TEXT NOT NULL)
 */
export const PERSISTENCE_FORMAT_VERSION = 6
