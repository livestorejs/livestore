import { ClientSessionSyncProcessorSimulationParams } from '@livestore/common'
import { ShutdownChannel } from '@livestore/common/leader-thread'
import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

import { tables } from './schema.ts'

export const StorageType = Schema.Literals(['in-memory', 'fs'])
export const AdapterType = Schema.Literals(['single-threaded', 'worker'])

export const Params = Schema.Struct({
  leaderPushBatchSize: Schema.optional(Schema.Number),
  simulation: Schema.optional(ClientSessionSyncProcessorSimulationParams),
})

export type Params = typeof Params.Type

export class InitialMessage extends Schema.Class<InitialMessage>('InitialMessage')({
  storeId: Schema.String,
  clientId: Schema.String,
  adapterType: AdapterType,
  storageType: StorageType,
  syncUrl: Schema.String,
  params: Params.pipe(Schema.optional),
}) {}

export const CreateTodos = Rpc.make('CreateTodos', {
  payload: {
    count: Schema.Number,
    commitBatchSize: Schema.optional(Schema.Number),
  },
  success: Schema.Void,
})

export const StreamTodos = Rpc.make('StreamTodos', {
  success: Schema.Array(tables.todo.rowSchema),
  stream: true,
})

export const OnShutdown = Rpc.make('OnShutdown', {
  success: Schema.Void,
  error: ShutdownChannel.All,
})

export const Rpcs = RpcGroup.make(CreateTodos, StreamTodos, OnShutdown)
export type Request = Rpc.Payload<RpcGroup.Rpcs<typeof Rpcs>>
