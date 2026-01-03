import { Context, Effect, Layer, PubSub, Schema, Stream } from '@livestore/utils/effect'

// --- CheckType ---

export const CheckType = Schema.Literal('typecheck', 'lint', 'test')
export type CheckType = typeof CheckType.Type

// --- CheckEvent ---

export class CheckStarted extends Schema.TaggedClass<CheckStarted>()('CheckStarted', {
  check: CheckType,
  name: Schema.String,
}) {}

export class CheckOutput extends Schema.TaggedClass<CheckOutput>()('CheckOutput', {
  check: CheckType,
  name: Schema.String,
  stream: Schema.Literal('stdout', 'stderr'),
  line: Schema.String,
}) {}

export class CheckCompleted extends Schema.TaggedClass<CheckCompleted>()('CheckCompleted', {
  check: CheckType,
  name: Schema.String,
  success: Schema.Boolean,
  durationMs: Schema.Number,
}) {}

export class CheckFailed extends Schema.TaggedClass<CheckFailed>()('CheckFailed', {
  check: CheckType,
  name: Schema.String,
  error: Schema.String,
}) {}

export type CheckEvent = CheckStarted | CheckOutput | CheckCompleted | CheckFailed

// --- CheckEventPubSub service ---

export class CheckEventPubSub extends Context.Tag('CheckEventPubSub')<CheckEventPubSub, PubSub.PubSub<CheckEvent>>() {
  /**
   * Create a live layer with unbounded PubSub for check events.
   */
  static readonly live = Layer.effect(CheckEventPubSub, PubSub.unbounded<CheckEvent>())

  /**
   * Publish a CheckStarted event.
   */
  static readonly publishStarted = (check: CheckType, name: string) =>
    Effect.gen(function* () {
      const pubsub = yield* CheckEventPubSub
      yield* PubSub.publish(pubsub, new CheckStarted({ check, name }))
    })

  /**
   * Publish a CheckOutput event.
   */
  static readonly publishOutput = (check: CheckType, name: string, stream: 'stdout' | 'stderr', line: string) =>
    Effect.gen(function* () {
      const pubsub = yield* CheckEventPubSub
      yield* PubSub.publish(pubsub, new CheckOutput({ check, name, stream, line }))
    })

  /**
   * Publish a CheckCompleted event.
   */
  static readonly publishCompleted = (check: CheckType, name: string, success: boolean, durationMs: number) =>
    Effect.gen(function* () {
      const pubsub = yield* CheckEventPubSub
      yield* PubSub.publish(pubsub, new CheckCompleted({ check, name, success, durationMs }))
    })

  /**
   * Publish a CheckFailed event.
   */
  static readonly publishFailed = (check: CheckType, name: string, error: string) =>
    Effect.gen(function* () {
      const pubsub = yield* CheckEventPubSub
      yield* PubSub.publish(pubsub, new CheckFailed({ check, name, error }))
    })

  /**
   * Subscribe to check events and return a Stream.
   */
  static readonly subscribe = Effect.gen(function* () {
    const pubsub = yield* CheckEventPubSub
    const queue = yield* PubSub.subscribe(pubsub)
    return Stream.fromQueue(queue)
  })

  /**
   * Subscribe to check events and return the raw Queue for manual consumption.
   */
  static readonly subscribeQueue = Effect.gen(function* () {
    const pubsub = yield* CheckEventPubSub
    return yield* PubSub.subscribe(pubsub)
  })
}
