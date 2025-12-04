import { BootStatus, MigrationsReport, UnknownError } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'

export class ResultBootStatus extends Schema.TaggedStruct('Bridge.ResultBootStatus', {
  exit: Schema.Exit({
    success: Schema.Struct({
      bootStatusUpdates: Schema.Array(BootStatus),
      migrationsReport: MigrationsReport,
    }),
    failure: UnknownError,
    defect: Schema.Defect,
  }),
}) {}

export class ResultStoreBootError extends Schema.TaggedStruct('Bridge.ResultStoreBootError', {
  exit: Schema.Exit({
    success: Schema.Any,
    failure: UnknownError,
    defect: Schema.Defect,
  }),
}) {}

export class ResultMultipleMigrations extends Schema.TaggedStruct('Bridge.ResultMultipleMigrations', {
  exit: Schema.Exit({
    success: Schema.Struct({
      migrationsCount: Schema.Number,
      archivedStateDbFiles: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          size: Schema.Number,
          lastModified: Schema.Number,
        }),
      ),
    }),
    failure: UnknownError,
    defect: Schema.Defect,
  }),
}) {}
