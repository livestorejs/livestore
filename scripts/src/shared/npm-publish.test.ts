import { describe, expect, it } from '@effect/vitest'

import { Effect, Fiber, TestClock } from '@livestore/utils/effect'

import {
  isPreviouslyStagedPublish,
  NpmPublishError,
  submitNpmPackage,
  verifyNpmPackageVisibility,
} from './npm-publish.ts'

const packageSpec = '@livestore/devtools-vite@0.5.0'
const stagedConflict = new NpmPublishError({
  message: 'npm error code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "0.5.0".',
})

describe('npm staged publish conflicts', () => {
  it('recognizes the registry E409 response but not unrelated conflicts', () => {
    expect(isPreviouslyStagedPublish(stagedConflict.message)).toBe(true)
    expect(isPreviouslyStagedPublish('409 Conflict - Cannot publish over previously published versions')).toBe(false)
    expect(isPreviouslyStagedPublish('E403 Forbidden')).toBe(false)
    expect(isPreviouslyStagedPublish('Cannot publish over previously staged version')).toBe(false)
  })

  it.effect('skips publishing an already-visible version on reruns', () =>
    Effect.gen(function* () {
      let publishes = 0
      yield* submitNpmPackage({
        packageSpec,
        publish: Effect.sync(() => {
          publishes++
        }),
        versionIsVisible: Effect.succeed(true),
      })
      expect(publishes).toBe(0)
    }),
  )

  it.effect('accepts already-staged as pending without retrying the publish', () =>
    Effect.gen(function* () {
      let publishes = 0
      yield* submitNpmPackage({
        packageSpec,
        publish: Effect.sync(() => {
          publishes++
        }).pipe(Effect.andThen(Effect.fail(stagedConflict))),
        versionIsVisible: Effect.succeed(false),
      })
      expect(publishes).toBe(1)
    }),
  )

  it.effect('preserves unrelated publish failures while the version is missing', () =>
    Effect.gen(function* () {
      const error = new NpmPublishError({ message: 'E403 Forbidden: OIDC authentication failed' })
      const failure = yield* submitNpmPackage({
        packageSpec,
        publish: Effect.fail(error),
        versionIsVisible: Effect.succeed(false),
      }).pipe(Effect.flip)
      expect(failure).toBe(error)
    }),
  )

  it.effect('accepts a failed publish only if its version became visible', () =>
    Effect.gen(function* () {
      let checks = 0
      yield* submitNpmPackage({
        packageSpec,
        publish: Effect.fail(new NpmPublishError({ message: 'network disconnected' })),
        versionIsVisible: Effect.sync(() => ++checks > 1),
      })
      expect(checks).toBe(2)
    }),
  )
})

describe('npm public visibility verification (core and DevTools)', () => {
  it.effect('waits for delayed visibility after successful submission', () =>
    Effect.gen(function* () {
      let checks = 0
      const versionIsVisible = Effect.sync(() => ++checks >= 3)
      yield* submitNpmPackage({ packageSpec, publish: Effect.void, versionIsVisible })
      const verifier = yield* verifyNpmPackageVisibility({ packageSpec, versionIsVisible }).pipe(Effect.forkChild)
      yield* TestClock.adjust('5 seconds')
      yield* Fiber.join(verifier)
      expect(checks).toBe(3)
    }),
  )

  it.effect('allows an already-staged version to become visible during the bounded wait', () =>
    Effect.gen(function* () {
      let checks = 0
      const versionIsVisible = Effect.sync(() => ++checks >= 4)
      yield* submitNpmPackage({ packageSpec, publish: Effect.fail(stagedConflict), versionIsVisible })
      const verifier = yield* verifyNpmPackageVisibility({ packageSpec, versionIsVisible }).pipe(Effect.forkChild)
      yield* TestClock.adjust('5 seconds')
      yield* Fiber.join(verifier)
      expect(checks).toBe(4)
    }),
  )

  it.effect('preserves registry probe execution errors rather than treating them as invisibility', () =>
    Effect.gen(function* () {
      const error = new Error('npm executable not found')
      const failure = yield* verifyNpmPackageVisibility({
        packageSpec,
        versionIsVisible: Effect.fail(error),
      }).pipe(Effect.flip)
      expect(failure).toBe(error)
    }),
  )

  it.effect('fails after exactly 60 waits and explains human approval rather than reporting success', () =>
    Effect.gen(function* () {
      let checks = 0
      const verifier = yield* verifyNpmPackageVisibility({
        packageSpec,
        versionIsVisible: Effect.sync(() => {
          checks++
          return false
        }),
      }).pipe(Effect.flip, Effect.forkChild)
      yield* TestClock.adjust('5 minutes')
      const failure = yield* Fiber.join(verifier)
      expect(checks).toBe(61)
      expect(failure.message).toContain(packageSpec)
      expect(failure.message).toContain('npm stage list @livestore/devtools-vite --json, match version 0.5.0')
      expect(failure.message).toContain('npm stage approve <stage-id> (interactive 2FA)')
      expect(failure.message).toContain('staging does not auto-promote')
      expect(failure.message).toContain('Then rerun this release')
    }),
  )
})
