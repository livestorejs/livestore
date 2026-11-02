import { ChildProcess, Effect, Fiber, Schedule, Schema, Stream } from '@livestore/utils/effect'

export class NpmPublishError extends Schema.TaggedError<NpmPublishError>()('NpmPublishError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A staged version reserves the version number but is not publicly installable. */
export const isPreviouslyStagedPublish = (output: string): boolean =>
  /\b(?:E409|409 Conflict)\b/i.test(output) && /cannot publish over previously staged version/i.test(output)

export const npmVisibilityFailure = (packageSpec: string): string =>
  `${packageSpec} is still not publicly visible after 60 retries at 5-second intervals. ` +
  'npm may have accepted a staged publish; staging does not auto-promote. ' +
  `A maintainer must run npm stage list ${packageSpec.slice(0, packageSpec.lastIndexOf('@'))} --json, match version ${packageSpec.slice(packageSpec.lastIndexOf('@') + 1)}, review with npm stage view <stage-id>, ` +
  'and approve with npm stage approve <stage-id> (interactive 2FA), or use the Staged Packages tab on npmjs.com. ' +
  'Then rerun this release. If no stage exists, check npm registry status and the publish logs. ' +
  'For unattended direct publishing, check the trusted publisher allows npm publish, not only npm stage publish.'

/** Capture npm's error text: the generic command error does not retain stderr. */
export const runNpmPublish = Effect.fn('runNpmPublish')(function* (args: readonly string[], cwd: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* Effect.acquireRelease(
        ChildProcess.make('npm', ['publish', ...args], {
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { DT_PASSTHROUGH: '1', DEVENV_TASK_PASSTHROUGH: '1' },
          extendEnv: true,
        }),
        (p) =>
          p.isRunning.pipe(
            Effect.flatMap((running) => (running === true ? p.kill().pipe(Effect.ignore) : Effect.void)),
            Effect.ignore,
          ),
      )
      const collect = (stream: typeof proc.stdout) =>
        stream.pipe(
          Stream.decodeText({ encoding: 'utf8' }),
          Stream.runFold(
            () => '',
            (output, chunk) => output + chunk,
          ),
          Effect.forkScoped,
        )
      const stdout = yield* collect(proc.stdout)
      const stderr = yield* collect(proc.stderr)
      const exitCode = yield* proc.exitCode
      const output = `${yield* Fiber.join(stdout)}\n${yield* Fiber.join(stderr)}`.trim()
      if (output.length > 0) yield* Effect.log(output)
      if (exitCode !== 0) return yield* new NpmPublishError({ message: `npm publish exited ${exitCode}: ${output}` })
    }),
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof NpmPublishError
        ? cause
        : new NpmPublishError({ message: 'Failed to execute npm publish', cause }),
    ),
  )
})

/** Successful submission (including an already-staged conflict) is not publication. */
export const submitNpmPackage = Effect.fn('submitNpmPackage')(function* <
  TPublishRequirements,
  TViewError,
  TViewRequirements,
>({
  packageSpec,
  publish,
  versionIsVisible,
}: {
  readonly packageSpec: string
  readonly publish: Effect.Effect<void, NpmPublishError, TPublishRequirements>
  readonly versionIsVisible: Effect.Effect<boolean, TViewError, TViewRequirements>
}) {
  if ((yield* versionIsVisible) === true) {
    yield* Effect.log(`${packageSpec} already published, skipping npm publish`)
    return
  }
  yield* publish.pipe(
    Effect.catchTag('NpmPublishError', (error) =>
      Effect.gen(function* () {
        if ((yield* versionIsVisible) === true) {
          yield* Effect.logWarning(`${packageSpec} became visible after npm publish failed; continuing`)
          return
        }
        if (isPreviouslyStagedPublish(error.message) === false) return yield* error
        yield* Effect.logWarning(
          `${packageSpec} is already staged (published-pending); not republishing. Human 2FA approval may be required.`,
        )
      }),
    ),
  )
  yield* Effect.log(`${packageSpec} submitted (publication pending verification).`)
})

export const verifyNpmPackageVisibility = Effect.fn('verifyNpmPackageVisibility')(function* <TError, TRequirements>({
  packageSpec,
  versionIsVisible,
}: {
  readonly packageSpec: string
  readonly versionIsVisible: Effect.Effect<boolean, TError, TRequirements>
}) {
  yield* Effect.log(`Verifying ${packageSpec} public registry visibility (60 retries, 5 seconds apart).`)
  let attempt = 0
  yield* Effect.gen(function* () {
    if ((yield* versionIsVisible) === true) return
    attempt++
    yield* Effect.logWarning(
      `${packageSpec} is not public yet (check ${attempt}/61); waiting for registry visibility or staged approval.`,
    )
    return yield* new NpmPublishError({ message: npmVisibilityFailure(packageSpec) })
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced('5 seconds').pipe(Schedule.upTo({ times: 60 })),
      while: (error) => error instanceof NpmPublishError,
    }),
    Effect.tapError((error) => Effect.logError(error instanceof NpmPublishError ? error.message : error)),
  )
  yield* Effect.log(`Verified ${packageSpec} is publicly available`)
})
