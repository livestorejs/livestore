import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const PushEvent = Schema.TaggedStruct('Push', {
  id: Schema.Number,
  batch: Schema.NonEmptyArray(LiveStoreEvent.Global.Encoded),
})

export const PingEvent = Schema.TaggedStruct('Ping', {
  id: Schema.Number,
})

export const PushEventResponse = Schema.TaggedStruct('PushResponse', {
  id: Schema.Number,
  exit: Schema.Exit({
    success: Schema.Void,
    failure: InvalidPushError,
    defect: Schema.Defect,
  }),
})

export const PullRequest = Schema.TaggedStruct('PullRequest', {
  id: Schema.Number,
  cursor: EventSequenceNumber.Global.Schema,
  live: Schema.Boolean,
})

export const PullCancel = Schema.TaggedStruct('PullCancel', {
  id: Schema.Number,
})

export const PullEvent = Schema.TaggedStruct('Pull', {
  id: Schema.Number,
  batch: Schema.NonEmptyArray(LiveStoreEvent.Global.Encoded),
})

export const PullErrorEvent = Schema.TaggedStruct('PullError', {
  id: Schema.Number,
  cause: Schema.Cause({
    error: InvalidPullError,
    defect: Schema.Defect,
  }),
})

export const PongEvent = Schema.TaggedStruct('Pong', {
  id: Schema.Number,
})

export const PushEventFromJson = Schema.parseJson(Schema.Union(PushEvent, PullRequest, PullCancel, PingEvent))
export const decodePushEventSync = Schema.decodeSync(PushEventFromJson)
export const encodePushEventSync = Schema.encodeSync(PushEventFromJson)

export const PullEventFromJson = Schema.parseJson(Schema.Union(PullEvent, PushEventResponse, PullErrorEvent, PongEvent))
export const decodePullEventSync = Schema.decodeSync(PullEventFromJson)
export const encodePullEventSync = Schema.encodeSync(PullEventFromJson)
