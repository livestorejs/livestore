import { Schema, Transferable } from '@livestore/utils/effect'

export const CreateConnection = Schema.TaggedStruct('WebmeshWorker.CreateConnection', {
  from: Schema.String,
  port: Transferable.MessagePort,
})

export const Request = Schema.Union([CreateConnection])
