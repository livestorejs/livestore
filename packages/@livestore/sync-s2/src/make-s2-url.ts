import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import * as ApiSchema from './api-schema.ts'

export const makeS2StreamName = (storeId: string) => storeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100)

/**
 * Decode `args` from URLSearchParams using Effect Schema, mirroring Electric's approach.
 */
export const decodePullArgsFromSearchParams = (searchParams: URLSearchParams): typeof ApiSchema.PullArgs.Type => {
  const UrlParamsSchema = Schema.Struct({ args: ApiSchema.ArgsSchema })
  const argsResult = Schema.decodeUnknownExit(UrlParamsSchema as any)(Object.fromEntries(searchParams.entries()))

  if (argsResult._tag !== 'Success') {
    return shouldNeverHappen(
      'Invalid search params provided to decodePullArgsFromSearchParams',
      searchParams,
      Object.fromEntries(searchParams.entries()),
    )
  }

  return (argsResult.value as typeof UrlParamsSchema.Type).args
}
