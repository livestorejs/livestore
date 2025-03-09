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

export type LeaderReqResSchema<
  Tag extends string,
  PayloadFields extends Schema.Struct.Fields,
  SuccessFields extends Schema.Struct.Fields,
  ErrorFields extends Schema.Struct.Fields = never,
> = {
  Request: Schema.TaggedStruct<`${Tag}.Request`, PayloadFields & DefaultFields>
  Response:
    | Schema.TaggedStruct<`${Tag}.Response.Success`, SuccessFields & DefaultFields>
    | (ErrorFields extends never ? never : Schema.TaggedStruct<`${Tag}.Response.Error`, ErrorFields & DefaultFields>)
  Success: Schema.TaggedStruct<`${Tag}.Response.Success`, SuccessFields & DefaultFields>
  Error: ErrorFields extends never ? never : Schema.TaggedStruct<`${Tag}.Response.Error`, ErrorFields & DefaultFields>
}

export const LeaderReqResMessage = <
  Tag extends string,
  PayloadFields extends Schema.Struct.Fields,
  SuccessFields extends Schema.Struct.Fields,
  ErrorFields extends Schema.Struct.Fields = never,
>(
  tag: Tag,
  fields: {
    payload: PayloadFields
    success: SuccessFields
    error?: ErrorFields
  },
): LeaderReqResSchema<Tag, PayloadFields, SuccessFields, ErrorFields> => {
  const Success = Schema.TaggedStruct(`${tag}.Response.Success`, {
    requestId,
    liveStoreVersion,
    ...fields.success,
  }).annotations({ identifier: `${tag}.Response.Success` })

  const Error = fields.error
    ? Schema.TaggedStruct(`${tag}.Response.Error`, {
        requestId,
        liveStoreVersion,
        ...fields.error,
      }).annotations({ identifier: `${tag}.Response.Error` })
    : Schema.Never

  return {
    Request: Schema.TaggedStruct(`${tag}.Request`, {
      requestId,
      liveStoreVersion,
      ...fields.payload,
    }).annotations({ identifier: `${tag}.Request` }),
    Response: Schema.Union(Success, Error),
    Success,
    Error,
  } as any
}
