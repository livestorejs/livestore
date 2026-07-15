import { Rpc, RpcGroup, Schema } from '@livestore/utils/effect'

export class TestRpcs extends RpcGroup.make(
  Rpc.make('Ping', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ response: Schema.String }),
  }),
  Rpc.make('Echo', {
    payload: Schema.Struct({ text: Schema.String }),
    success: Schema.Struct({ echo: Schema.String }),
  }),
  Rpc.make('Add', {
    payload: Schema.Struct({ a: Schema.Finite, b: Schema.Finite }),
    success: Schema.Struct({ result: Schema.Finite }),
  }),
  Rpc.make('Defect', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ never: Schema.String }),
  }),
  Rpc.make('Fail', {
    payload: Schema.Struct({ message: Schema.String }),
    success: Schema.Struct({ never: Schema.String }),
    error: Schema.String,
  }),
  Rpc.make('Stream', {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      maybeNumber: Schema.Option(Schema.Finite),
    }),
    stream: true,
  }),
  Rpc.make('StreamError', {
    payload: Schema.Struct({ count: Schema.Finite, errorAfter: Schema.Finite }),
    success: Schema.Finite,
    error: Schema.String,
    stream: true,
  }),
  Rpc.make('StreamDefect', {
    payload: Schema.Struct({ count: Schema.Finite, defectAfter: Schema.Finite }),
    success: Schema.Finite,
    stream: true,
  }),
  Rpc.make('StreamInterruptible', {
    payload: Schema.Struct({ delay: Schema.Finite, interruptAfterCount: Schema.Finite }),
    success: Schema.Finite,
    stream: true,
  }),
) {}
export type TestRpcsI = RpcGroup.Rpcs<typeof TestRpcs>
