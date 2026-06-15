// import * as Transferable from 'effect/unstable/workers/Transferable'
import * as Schema from 'effect/Schema'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

export class User extends Schema.Class<User>('User')({
  id: Schema.Number,
  name: Schema.String,
}) {}

export class Person extends Schema.Class<Person>('Person')({
  id: Schema.Number,
  name: Schema.String,
  // data: Transferable.Uint8Array,
  data: Schema.Uint8Array,
}) {}

export class InitialMessage extends Schema.Class<InitialMessage>('InitialMessage')({
  name: Schema.String,
  data: Schema.Uint8Array,
  // data: Transferable.Uint8Array,
}) {}

export const SpanInfo = Schema.Struct({
  name: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  parent: Schema.Option(
    Schema.Struct({
      traceId: Schema.String,
      spanId: Schema.String,
    }),
  ),
})

export class WorkerRpcs extends RpcGroup.make(
  Rpc.make('GetUserById', {
    payload: { id: Schema.Number },
    success: User,
  }),
  Rpc.make('GetPersonById', {
    payload: { id: Schema.Number },
    success: Person,
    stream: true,
  }),
  Rpc.make('GetSpan', {
    success: SpanInfo,
  }),
  Rpc.make('RunnerInterrupt', {
    success: Schema.Void,
  }),
  Rpc.make('StartStubbornWorker', {
    payload: { blockDuration: Schema.Number },
    success: Schema.Struct({ pid: Schema.Number }),
  }),
) {}
