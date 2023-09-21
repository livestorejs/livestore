import * as Duration from '@effect/data/Duration'
import { pipe } from '@effect/data/Function'
import * as Schedule from '@effect/io/Schedule'

export * from '@effect/io/Schedule'

export const exponentialBackoff10Sec: Schedule.Schedule<never, unknown, Duration.DurationInput> = pipe(
  Schedule.exponential(Duration.millis(10), 4), // 10ms, 40ms, 160ms, 640ms, 2560ms, ...
  Schedule.andThenEither(Schedule.spaced(Duration.seconds(1))),
  Schedule.compose(Schedule.elapsed),
  Schedule.whileOutput(Duration.lessThanOrEqualTo(Duration.seconds(10))), // max 10 seconds
)
