/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: Biome bug */
export * from 'effect/Stream'

import { type Cause, Chunk, Effect, Option, pipe, Ref, Stream } from 'effect'
import { dual } from 'effect/Function'

export const tapLog = <R, E, A>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
  tapChunk<never, never, A, void>(Effect.forEach((_) => Effect.succeed(console.log(_))))(stream)

export const tapSync =
  <A>(tapFn: (a: A) => unknown) =>
  <R, E>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    Stream.tap(stream, (a) => Effect.sync(() => tapFn(a)))

export const tapLogWithLabel =
  (label: string) =>
  <R, E, A>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    tapChunk<never, never, A, void>(Effect.forEach((_) => Effect.succeed(console.log(label, _))))(stream)

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

/**
 * Returns the first element of the stream or `None` if the stream is empty.
 * It's different than `Stream.runHead` which runs the stream to completion.
 * */
export const runFirst = <A, E, R>(stream: Stream.Stream<A, E, R>): Effect.Effect<Option.Option<A>, E, R> =>
  stream.pipe(Stream.take(1), Stream.runCollect, Effect.map(Chunk.head))

/**
 * Returns the first element of the stream or throws a `NoSuchElementException` if the stream is empty.
 * It's different than `Stream.runHead` which runs the stream to completion.
 * */
export const runFirstUnsafe = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
): Effect.Effect<A, Cause.NoSuchElementException | E, R> => runFirst(stream).pipe(Effect.flatten)

export const runCollectReadonlyArray = <A, E, R>(stream: Stream.Stream<A, E, R>): Effect.Effect<readonly A[], E, R> =>
  stream.pipe(Stream.runCollect, Effect.map(Chunk.toReadonlyArray))

/**
 * Concatenates two streams where the second stream has access to the last element
 * of the first stream as an `Option`. If the first stream is empty, the callback
 * receives `Option.none()`.
 *
 * @param stream - The first stream to consume
 * @param getStream2 - Function that receives the last element from the first stream
 *   and returns the second stream to concatenate
 * @returns A new stream containing all elements from both streams
 *
 * @example
 * ```ts
 * // Direct usage
 * const result = concatWithLastElement(
 *   Stream.make(1, 2, 3),
 *   lastElement => lastElement.pipe(
 *     Option.match({
 *       onNone: () => Stream.make('empty'),
 *       onSome: last => Stream.make(`last-was-${last}`)
 *     })
 *   )
 * )
 *
 * // Piped usage
 * const result = Stream.make(1, 2, 3).pipe(
 *   concatWithLastElement(lastElement =>
 *     Stream.make(lastElement.pipe(Option.getOrElse(() => 0)) * 10)
 *   )
 * )
 * ```
 */
export const concatWithLastElement: {
  <A1, A2, E2, R2>(
    getStream2: (lastElement: Option.Option<A1>) => Stream.Stream<A2, E2, R2>,
  ): <E1, R1>(stream: Stream.Stream<A1, E1, R1>) => Stream.Stream<A1 | A2, E1 | E2, R1 | R2>
  <A1, E1, R1, A2, E2, R2>(
    stream: Stream.Stream<A1, E1, R1>,
    getStream2: (lastElement: Option.Option<A1>) => Stream.Stream<A2, E2, R2>,
  ): Stream.Stream<A1 | A2, E1 | E2, R1 | R2>
} = dual(
  2,
  <A1, E1, R1, A2, E2, R2>(
    stream1: Stream.Stream<A1, E1, R1>,
    getStream2: (lastElement: Option.Option<A1>) => Stream.Stream<A2, E2, R2>,
  ): Stream.Stream<A1 | A2, E1 | E2, R1 | R2> =>
    pipe(
      Ref.make<Option.Option<A1>>(Option.none()),
      Stream.fromEffect,
      Stream.flatMap((lastRef) =>
        pipe(
          stream1,
          Stream.tap((value) => Ref.set(lastRef, Option.some(value))),
          Stream.concat(pipe(Ref.get(lastRef), Effect.map(getStream2), Stream.unwrap)),
        ),
      ),
    ),
)

/**
 * Emits a default value if the stream is empty, otherwise passes through all elements.
 * Uses `concatWithLastElement` internally to detect if the stream was empty.
 *
 * @param fallbackValue - The value to emit if the stream is empty
 * @returns A dual function that can be used in pipe or direct call
 *
 * @example
 * ```ts
 * // Direct usage
 * const result = emitIfEmpty(Stream.empty, 'default')
 * // Emits: 'default'
 *
 * // Piped usage
 * const result = Stream.make(1, 2, 3).pipe(emitIfEmpty('fallback'))
 * // Emits: 1, 2, 3
 *
 * const empty = Stream.empty.pipe(emitIfEmpty('fallback'))
 * // Emits: 'fallback'
 * ```
 */
export const emitIfEmpty: {
  <A>(fallbackValue: A): <E, R>(stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R>
  <A, E, R>(stream: Stream.Stream<A, E, R>, fallbackValue: A): Stream.Stream<A, E, R>
} = dual(
  2,
  <A, E, R>(stream: Stream.Stream<A, E, R>, fallbackValue: A): Stream.Stream<A, E, R> =>
    concatWithLastElement(stream, (lastElement) =>
      lastElement._tag === 'None' ? Stream.make(fallbackValue) : Stream.empty,
    ),
)
