export * from 'effect/Stream'

import type { Chunk } from 'effect'
import { Effect, pipe, Stream } from 'effect'

export const tapLog = <R, E, A>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
  tapChunk<never, never, A, void>(Effect.forEach((_) => Effect.succeed(console.log(_))))(stream)

export const tapChunk =
  <R1, E1, A, Z>(f: (a: Chunk.Chunk<A>) => Effect.Effect<Z, E1, R1>) =>
  <R, E>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E1 | E, R1 | R> =>
    Stream.mapChunksEffect(self, (chunks) =>
      pipe(
        f(chunks),
        Effect.map(() => chunks),
      ),
    )
