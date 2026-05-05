import { Duration, pipe, Schedule } from 'effect'

export * from 'effect/Schedule'

export const exponentialBackoff10Sec: Schedule.Schedule<Duration.DurationInput> = pipe(
  Schedule.exponential(Duration.millis(10), 4), // 10ms, 40ms, 160ms, 640ms, 2560ms, ...
  Schedule.andThen(Schedule.spaced(Duration.seconds(1))),
)
