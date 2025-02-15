import { Schema } from '@livestore/utils/effect'

import { liveStoreVersion as pkgVersion } from '../version.js'

export const requestId = Schema.String
export const clientId = Schema.String
export const sessionId = Schema.String
export const liveStoreVersion = Schema.Literal(pkgVersion)

export const LSDMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  Schema.TaggedStruct(tag, {
    liveStoreVersion,
    ...fields,
  }).annotations({ identifier: tag })

export const LSDChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
    clientId,
    ...fields,
  })

export const LSDClientSessionChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) =>
  LSDMessage(tag, {
    clientId,
    sessionId,
    ...fields,
  })

export const LSDClientSessionReqResMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) =>
  LSDMessage(tag, {
    clientId,
    sessionId,
    requestId,
    ...fields,
  })

export const LSDReqResMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDChannelMessage(tag, {
    requestId,
    ...fields,
  })

type DefaultFields = {
  readonly requestId: typeof Schema.String
  readonly liveStoreVersion: typeof liveStoreVersion
  readonly clientId: typeof Schema.String
}

export const LeaderReqResMessage = <
  Tag extends string,
  ReqFields extends Schema.Struct.Fields,
  ResFields extends Schema.Struct.Fields,
>(
  tag: Tag,
  fields: {
    payload: ReqFields
    success: ResFields
  },
): {
  Request: Schema.TaggedStruct<`${Tag}.Request`, ReqFields & DefaultFields>
  Response: Schema.TaggedStruct<`${Tag}.Response`, ResFields & DefaultFields>
} => {
  return {
    Request: Schema.TaggedStruct(`${tag}.Request`, {
      requestId,
      liveStoreVersion,
      ...fields.payload,
    }).annotations({ identifier: `${tag}.Request` }),
    Response: Schema.TaggedStruct(`${tag}.Response`, {
      requestId,
      liveStoreVersion,
      ...fields.success,
    }).annotations({ identifier: `${tag}.Response` }),
  } as any
}
