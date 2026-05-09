import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

export class User extends Schema.Class<User>('User')({
  id: Schema.Number,
  name: Schema.String,
}) {}

export class Person extends Schema.Class<Person>('Person')({
  id: Schema.Number,
  name: Schema.String,
  data: Schema.Uint8Array,
}) {}

export class InitialMessage extends Schema.Class<InitialMessage>('InitialMessage')({
  name: Schema.String,
  data: Schema.Uint8Array,
}) {}

export const GetUserById = Rpc.make('GetUserById', {
  payload: {
    id: Schema.Number,
  },
  success: User,
})

export const GetPersonById = Rpc.make('GetPersonById', {
  payload: {
    id: Schema.Number,
  },
  success: Person,
  stream: true,
})

export const RunnerInterrupt = Rpc.make('RunnerInterrupt', {
  success: Schema.Void,
})

export const StartStubbornWorker = Rpc.make('StartStubbornWorker', {
  payload: {
    blockDuration: Schema.Number,
  },
  success: Schema.Struct({
    pid: Schema.Number,
  }),
})

export const GetSpan = Rpc.make('GetSpan', {
  success: Schema.Struct({
    name: Schema.String,
    traceId: Schema.String,
    spanId: Schema.String,
    parent: Schema.Option(
      Schema.Struct({
        traceId: Schema.String,
        spanId: Schema.String,
      }),
    ),
  }),
})

export const WorkerRpcs = RpcGroup.make(GetUserById, GetPersonById, RunnerInterrupt, StartStubbornWorker, GetSpan)
