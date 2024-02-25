import { Duration, pipe, Schedule } from 'effect'

export * from 'effect/Schedule'

export const exponentialBackoff10Sec: Schedule.Schedule<Duration.DurationInput> = pipe(
  Schedule.exponential(Duration.millis(10), 4), // 10ms, 40ms, 160ms, 640ms, 2560ms, ...
  Schedule.andThenEither(Schedule.spaced(Duration.seconds(1))),
  Schedule.compose(Schedule.elapsed),
  Schedule.whileOutput(Duration.lessThanOrEqualTo(Duration.seconds(10))), // max 10 seconds
)
