import { Rpc, RpcGroup, Schema, Transferable } from '@livestore/utils/effect'

export const CreateConnection = Rpc.make('CreateConnection', {
  payload: {
    from: Schema.String,
    port: Transferable.MessagePort,
  },
  success: Schema.Struct({}),
  stream: true,
})

export const Rpcs = RpcGroup.make(CreateConnection)
export type Request = Rpc.Payload<RpcGroup.Rpcs<typeof Rpcs>>
