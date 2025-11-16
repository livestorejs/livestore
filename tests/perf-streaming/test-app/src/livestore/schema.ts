import { makeSchema, Schema, State } from '@livestore/livestore'

import { events } from './events.ts'

const streamRuns = State.SQLite.table({
  name: 'stream_runs',
  columns: {
    datasetId: State.SQLite.text({ primaryKey: true }),
    totalEvents: State.SQLite.integer({ nullable: false }),
    startedAt: State.SQLite.integer({ nullable: false }),
  },
})

const streamEvents = State.SQLite.table({
  name: 'stream_events',
  columns: {
    datasetId: State.SQLite.text({ nullable: false }),
    sequence: State.SQLite.integer({ nullable: false }),
    label: State.SQLite.text({ nullable: false }),
  },
  indexes: [{ name: 'stream_events_dataset_sequence', columns: ['datasetId', 'sequence'], isUnique: true }],
})

const materializers = State.SQLite.materializers(events, {
  'v1.StreamRunStarted': ({ datasetId, totalEvents }) => [
    streamRuns.delete().where({ datasetId }),
    streamEvents.delete().where({ datasetId }),
    streamRuns.insert({ datasetId, totalEvents, startedAt: Date.now() }),
  ],
  'v1.StreamEventRecorded': ({ datasetId, sequence, label }) => streamEvents.insert({ datasetId, sequence, label }),
  'v1.StreamRunCleared': ({ datasetId }) => [
    streamEvents.delete().where({ datasetId }),
    streamRuns.delete().where({ datasetId }),
  ],
})

export const tables = { streamRuns, streamEvents }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

export const SyncPayload = Schema.Struct({ authToken: Schema.String })

export { events }

export type StreamRun = typeof streamRuns.Type
export type StreamEvent = typeof streamEvents.Type
