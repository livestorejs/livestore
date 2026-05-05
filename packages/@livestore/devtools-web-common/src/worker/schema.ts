import { Schema, Transferable } from '@livestore/utils/effect'

export class CreateConnection extends Schema.TaggedRequest<CreateConnection>()('DevtoolsWebCommon.CreateConnection', {
  payload: {
    from: Schema.String,
    port: Transferable.MessagePort,
  },
  success: Schema.Struct({}),
  failure: Schema.Never,
}) {}

export const Request = Schema.Union([CreateConnection])
export type Request = typeof Request.Type
