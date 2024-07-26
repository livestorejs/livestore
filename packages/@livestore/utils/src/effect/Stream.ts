export * from 'effect/Stream'

import type { Chunk } from 'effect'
import { Effect, Option, pipe, Ref, Stream } from 'effect'

export const tapLog = <R, E, A>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
  tapChunk<never, never, A, void>(Effect.forEach((_) => Effect.succeed(console.log(_))))(stream)

export const tapSync =
  <A>(tapFn: (a: A) => unknown) =>
  <R, E>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    Stream.tap(stream, (a) => Effect.sync(() => tapFn(a)))

export const tapChunk =
  <R1, E1, A, Z>(f: (a: Chunk.Chunk<A>) => Effect.Effect<Z, E1, R1>) =>
  <R, E>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E1 | E, R1 | R> =>
    Stream.mapChunksEffect(self, (chunks) =>
      pipe(
        f(chunks),
        Effect.map(() => chunks),
      ),
    )

const isIdentity = <A>(a1: A, a2: A): boolean => a1 === a2

export const skipRepeated =
  <A>(isEqual: (prevEl: A, newEl: A) => boolean = isIdentity) =>
  <R, E>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    skipRepeated_(stream, isEqual)

export const skipRepeated_ = <R, E, A>(
  stream: Stream.Stream<A, E, R>,
  isEqual: (prevEl: A, newEl: A) => boolean = isIdentity,
): Stream.Stream<A, E, R> =>
  pipe(
    Ref.make<Option.Option<A>>(Option.none()),
    Stream.fromEffect,
    Stream.flatMap((ref) =>
      pipe(
        stream,
        Stream.filterEffect((el) =>
          pipe(
            Ref.get(ref),
            Effect.flatMap((prevEl) => {
              if (prevEl._tag === 'None' || isEqual(prevEl.value, el) === false) {
                return pipe(
                  Ref.set(ref, Option.some(el)),
                  Effect.map(() => true),
                )
              } else {
                return Effect.succeed(false)
              }
            }),
          ),
        ),
      ),
    ),
  )
