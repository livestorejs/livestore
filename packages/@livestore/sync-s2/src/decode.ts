import { LiveStoreEvent } from '@livestore/common/schema'
import { Option, Schema } from '@livestore/utils/effect'
import type * as HttpClientGenerated from './http-client-generated.ts'
import { S2SeqNum } from './types.ts'

const ReadBatchSchema = Schema.Struct({
  records: Schema.Array(
    Schema.Struct({
      body: Schema.optional(Schema.parseJson(LiveStoreEvent.AnyEncodedGlobal)),
      seq_num: S2SeqNum,
    }),
  ),
}).annotations({ title: '@livestore/sync-s2:ReadBatchSchema' })

export const decodeReadBatch = (
  readBatch: typeof HttpClientGenerated.ReadBatch.Type,
): ReadonlyArray<{
  eventEncoded: LiveStoreEvent.AnyEncodedGlobal
  metadata: Option.Option<{ s2SeqNum: S2SeqNum }>
}> => {
  const decoded = Schema.decodeSync(ReadBatchSchema)(readBatch)
  return decoded.records
    .filter((r): r is { body: LiveStoreEvent.AnyEncodedGlobal; seq_num: S2SeqNum } => r.body !== undefined)
    .map((r) => ({
      eventEncoded: r.body,
      metadata: Option.some({ s2SeqNum: r.seq_num }),
    }))
}
