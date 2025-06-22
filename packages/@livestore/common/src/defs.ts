import { Schema } from '@livestore/utils/effect'

import { EventSequenceNumber } from './schema/mod.js'

export const MigrationsReportEntry = Schema.Struct({
  tableName: Schema.String,
  hashes: Schema.Struct({
    expected: Schema.Number,
    actual: Schema.optional(Schema.Number),
  }),
})

export const MigrationsReport = Schema.Struct({
  migrations: Schema.Array(MigrationsReportEntry),
})

export type MigrationsReport = typeof MigrationsReport.Type

export type MigrationsReportEntry = typeof MigrationsReportEntry.Type

export const LeaderPullCursor = Schema.Struct({
  mergeCounter: Schema.Number,
  eventNum: EventSequenceNumber.EventSequenceNumber,
})

export type LeaderPullCursor = typeof LeaderPullCursor.Type
