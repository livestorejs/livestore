import { Effect, RpcClientError, Schema, Stream } from '@livestore/utils/effect'
import type * as WebmeshWorker from '@livestore/webmesh/worker'

export type WebmeshWorkerProxy = Parameters<typeof WebmeshWorker.connectViaWorker>[0]['worker']
export type WithoutRpcClientError<E> = E extends { readonly _tag: infer Tag }
  ? 'RpcClientError' extends Tag
    ? never
    : E
  : E
export type WebmeshWorkerRpcClient = {
  readonly ['WebmeshWorker.CreateConnection']: (
    request: typeof WebmeshWorker.Schema.CreateConnection.Type,
  ) => Stream.Stream<{}, RpcClientError.RpcClientError>
}

export const isRpcClientError = (error: unknown): error is RpcClientError.RpcClientError =>
  Schema.is(RpcClientError.RpcClientError)(error)

export const dieOnRpcClientError = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, WithoutRpcClientError<E>, R> =>
  (effect as Effect.Effect<A, RpcClientError.RpcClientError | WithoutRpcClientError<E>, R>).pipe(
    Effect.catchIf(isRpcClientError, (error) => Effect.die(error)),
  ) as Effect.Effect<A, WithoutRpcClientError<E>, R>

export const dieOnRpcClientErrorStream = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, WithoutRpcClientError<E>, R> =>
  (stream as Stream.Stream<A, RpcClientError.RpcClientError | WithoutRpcClientError<E>, R>).pipe(
    Stream.catchIf(
      isRpcClientError,
      (error) => Stream.die(error),
      (error) => Stream.fail(error),
    ),
  ) as Stream.Stream<A, WithoutRpcClientError<E>, R>

export const makeWebmeshWorkerProxy = (client: WebmeshWorkerRpcClient): WebmeshWorkerProxy => ({
  execute: (request) => dieOnRpcClientErrorStream(client['WebmeshWorker.CreateConnection'](request)),
})
