import { Schema } from '@effect/schema'
import * as msgpack from 'msgpackr'

export const MsgPack = <A, I>(schema: Schema.Schema<A, I>) =>
  Schema.transform(Schema.Uint8ArrayFromSelf, schema, {
    encode: (decoded) => msgpack.pack(decoded),
    decode: (encodedBytes) => msgpack.unpack(encodedBytes),
  })
