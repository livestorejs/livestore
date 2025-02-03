import { Schema } from '@livestore/utils/effect'

import { liveStoreVersion as pkgVersion } from '../version.js'

const requestId = Schema.String
const clientId = Schema.String
const sessionId = Schema.String
const liveStoreVersion = Schema.Literal(pkgVersion)

export const LSDMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  Schema.TaggedStruct(tag, {
    liveStoreVersion,
    ...fields,
  }).annotations({ identifier: tag })

export const LSDChannelMessage = <Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
  LSDMessage(tag, {
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

export class Disconnect extends LSDClientSessionChannelMessage('LSD.Disconnect', {}) {}

export class Ping extends LSDReqResMessage('LSD.Ping', {}) {}

export class Pong extends LSDReqResMessage('LSD.Pong', {}) {}
