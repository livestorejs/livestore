import { BootStatus, MigrationsReport, UnknownError } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'

export class ResultBootStatus extends Schema.TaggedStruct('Bridge.ResultBootStatus', {
  exit: Schema.Exit(
    Schema.Struct({
      bootStatusUpdates: Schema.Array(BootStatus),
      migrationsReport: MigrationsReport,
    }),
    UnknownError,
    Schema.Defect(),
  ),
}) {}

export class ResultStoreBootError extends Schema.TaggedStruct('Bridge.ResultStoreBootError', {
  exit: Schema.Exit(Schema.Any, UnknownError, Schema.Defect()),
}) {}

export class ResultMultipleMigrations extends Schema.TaggedStruct('Bridge.ResultMultipleMigrations', {
  exit: Schema.Exit(
    Schema.Struct({
      migrationsCount: Schema.Number,
      archivedStateDbFiles: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          size: Schema.Number,
          lastModified: Schema.Number,
        }),
      ),
    }),
    UnknownError,
    Schema.Defect(),
  ),
}) {}
