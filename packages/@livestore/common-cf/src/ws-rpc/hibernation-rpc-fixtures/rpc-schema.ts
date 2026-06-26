import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

/** Minimal RPC surface for the hibernation-outcome tests against the real WS-RPC server. */
export class HibRpcs extends RpcGroup.make(
  Rpc.make('Ping', { payload: Schema.Struct({}), success: Schema.Struct({}) }),
  /** Returns the DO's per-instance uuid — changes iff the DO was evicted and reconstructed (i.e. hibernated). */
  Rpc.make('InstanceId', { payload: Schema.Struct({}), success: Schema.Struct({ id: Schema.String }) }),
  Rpc.make('Live', { payload: Schema.Struct({}), success: Schema.Number, stream: true }),
) {}
