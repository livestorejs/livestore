import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

export class HibRpcs extends RpcGroup.make(
  Rpc.make('Ping', { payload: Schema.Struct({}), success: Schema.Struct({}) }),
  Rpc.make('InstanceId', { payload: Schema.Struct({}), success: Schema.Struct({ id: Schema.String }) }),
  Rpc.make('Live', { payload: Schema.Struct({}), success: Schema.Number, stream: true }),
) {}
