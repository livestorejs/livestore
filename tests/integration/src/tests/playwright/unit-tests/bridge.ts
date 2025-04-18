import { BootStatus, MigrationsReport, UnexpectedError } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'

export class ResultBootStatus extends Schema.TaggedStruct('Bridge.ResultBootStatus', {
  exit: Schema.Exit({
    success: Schema.Struct({
      bootStatusUpdates: Schema.Array(BootStatus),
      migrationsReport: MigrationsReport,
    }),
    failure: UnexpectedError,
    defect: Schema.Defect,
  }),
}) {}

export class ResultStoreBootError extends Schema.TaggedStruct('Bridge.ResultStoreBootError', {
  exit: Schema.Exit({
    success: Schema.Any,
    failure: UnexpectedError,
    defect: Schema.Defect,
  }),
}) {}
