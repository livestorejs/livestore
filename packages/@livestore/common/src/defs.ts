import { Schema } from '@livestore/utils/effect'

export const MigrationsReportEntry = Schema.Struct({
  tableName: Schema.String,
  hashes: Schema.Struct({
    expected: Schema.String,
    actual: Schema.optional(Schema.String),
  }),
})

export const MigrationsReport = Schema.Struct({
  migrations: Schema.Array(MigrationsReportEntry),
})

export type MigrationsReport = typeof MigrationsReport.Type

export type MigrationsReportEntry = typeof MigrationsReportEntry.Type
