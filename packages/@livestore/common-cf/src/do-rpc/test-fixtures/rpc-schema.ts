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
    payload: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
    success: Schema.Struct({ result: Schema.Number }),
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
      maybeNumber: Schema.Option(Schema.Number),
    }),
    stream: true,
  }),
  Rpc.make('StreamError', {
    payload: Schema.Struct({ count: Schema.Number, errorAfter: Schema.Number }),
    success: Schema.Number,
    error: Schema.String,
    stream: true,
  }),
  Rpc.make('StreamDefect', {
    payload: Schema.Struct({ count: Schema.Number, defectAfter: Schema.Number }),
    success: Schema.Number,
    stream: true,
  }),
  Rpc.make('StreamInterruptible', {
    payload: Schema.Struct({ delay: Schema.Number, interruptAfterCount: Schema.Number }),
    success: Schema.Number,
    stream: true,
  }),
  Rpc.make('StreamBugScenarioDoServer', {
    payload: Schema.Struct({}),
    success: Schema.Number,
    stream: true,
  }),
  Rpc.make('StreamBugScenarioDoClient', {
    payload: Schema.Struct({}),
    success: Schema.Number,
  }),
) {}
export type TestRpcsI = RpcGroup.Rpcs<typeof TestRpcs>
