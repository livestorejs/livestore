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

export class ResultMultipleMigrations extends Schema.TaggedStruct('Bridge.ResultMultipleMigrations', {
  exit: Schema.Exit({
    success: Schema.Struct({
      migrationsCount: Schema.Number,
    }),
    failure: UnexpectedError,
    defect: Schema.Defect,
  }),
}) {}

export class ResultDuplicateSessionId extends Schema.TaggedStruct('Bridge.ResultDuplicateSessionId', {
  exit: Schema.Exit({
    success: Schema.Struct({
      firstSessionId: Schema.String,
      secondSessionId: Schema.String,
      sessionStorageBeforeSecond: Schema.Union(Schema.String, Schema.Null),
      sessionStorageAfterSecond: Schema.Union(Schema.String, Schema.Null),
      workerNames: Schema.Array(
        Schema.Struct({
          tab: Schema.Literal('first', 'second'),
          name: Schema.String,
        }),
      ),
    }),
    failure: UnexpectedError,
    defect: Schema.Defect,
  }),
}) {}
