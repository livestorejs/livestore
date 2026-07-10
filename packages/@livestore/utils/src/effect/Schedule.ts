import { Duration, Effect, pipe, Schedule } from 'effect'

export * from 'effect/Schedule'

export const exponentialBackoff10Sec = pipe(
  Schedule.exponential(Duration.millis(10), 4), // 10ms, 40ms, 160ms, 640ms, 2560ms, ...
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(1)))),
  Schedule.upTo({ duration: Duration.seconds(10) }),
)
