import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
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
  const argsResult = Schema.decodeUnknownEither(Schema.Struct({ args: Schema.parseJson(ApiSchema.PullPayload) }))(
    Object.fromEntries(providedSearchParams.entries()),
  )

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
  const searchParams = new URLSearchParams()
  searchParams.set('table', tableName)
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
  return `eventlog_${PERSISTENCE_FORMAT_VERSION}_${escapedStoreId}`
}

/**
 * Needs to be bumped when the storage format changes (e.g. eventlogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 6
