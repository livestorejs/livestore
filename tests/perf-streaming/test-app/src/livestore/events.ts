import { Events, Schema } from '@livestore/livestore'

export const streamRunStarted = Events.synced({
  name: 'v1.StreamRunStarted',
  schema: Schema.Struct({
    datasetId: Schema.String,
    totalEvents: Schema.Number,
  }),
})

export const streamEventRecorded = Events.synced({
  name: 'v1.StreamEventRecorded',
  schema: Schema.Struct({
    datasetId: Schema.String,
    sequence: Schema.Number,
    label: Schema.String,
  }),
})

export const streamRunCleared = Events.synced({
  name: 'v1.StreamRunCleared',
  schema: Schema.Struct({ datasetId: Schema.String }),
})

export const events = {
  streamRunStarted,
  streamEventRecorded,
  streamRunCleared,
}
