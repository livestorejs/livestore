/**
 * Durable Object hibernation guard.
 *
 * A Cloudflare Durable Object only hibernates — and stops billing while idle — when its isolate has
 * **no pending `setTimeout`/`setInterval`**. LiveStore's sync DO holds each WebSocket/RPC connection
 * open by parking an Effect fiber that never completes. If a park schedules a timer to stay alive, the
 * DO can never hibernate and bills for full wall-clock time even with zero traffic — the regression
 * tracked in livestorejs/livestore#1328.
 *
 * These tests pin the invariant that keeps idle hibernation working: every park LiveStore uses to hold
 * a connection open must stay genuinely suspended *and* schedule no timer of any kind.
 */
import { describe, expect, test } from 'vitest'

import { Effect, Fiber, Layer, Stream } from 'effect'

type Timer = { readonly kind: 'interval' | 'timeout'; readonly delay: number }

/** Swap in timer globals that record every timer still scheduled (i.e. created and not cleared). */
const spyOnTimers = () => {
  const scheduled = new Map<unknown, Timer>()
  const real = {
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
  }
  const record =
    (kind: Timer['kind'], schedule: (...args: any[]) => any) =>
    (cb: any, delay = 0, ...args: any[]) => {
      const id = schedule(cb, delay, ...args)
      scheduled.set(id, { kind, delay })
      return id
    }
  globalThis.setInterval = record('interval', real.setInterval) as typeof globalThis.setInterval
  globalThis.setTimeout = record('timeout', real.setTimeout) as typeof globalThis.setTimeout
  globalThis.clearInterval = ((id?: any) => {
    scheduled.delete(id)
    return real.clearInterval(id)
  }) as typeof globalThis.clearInterval
  globalThis.clearTimeout = ((id?: any) => {
    scheduled.delete(id)
    return real.clearTimeout(id)
  }) as typeof globalThis.clearTimeout
  return { scheduled, real, restore: () => Object.assign(globalThis, real) }
}

/** Run a park, let it settle, then report whether it is still suspended and which timers it left scheduled. */
const observePark = async (park: Effect.Effect<unknown, unknown, never>) => {
  const { scheduled, real, restore } = spyOnTimers()
  const fiber = Effect.runFork(park)
  await new Promise<void>((resolve) => real.setTimeout(resolve, 50))
  // `pollUnsafe()` is `undefined` only while a fiber is suspended; any finished fiber returns an `Exit`.
  // So this tells "still holding the connection open" apart from "silently exited".
  const stillParked = fiber.pollUnsafe() === undefined
  restore()
  await Effect.runPromise(Fiber.interrupt(fiber))
  return { stillParked, timers: [...scheduled.values()] }
}

/** The ways LiveStore's sync DO parks a fiber to hold a connection open. */
const connectionParks = {
  'Effect.never': Effect.never,
  'Stream.never': Stream.runDrain(Stream.never),
  'Layer.launch': Layer.launch(Layer.empty),
  'RPC server hold-open': Effect.onExit(Effect.never, () => Effect.void),
}

describe('a connection-holding park must not block Durable Object hibernation', () => {
  // Self-check: a scheduled timer must be observed (and a cleared one forgotten), otherwise the
  // "no timer" assertions below could pass against a blind spy.
  test('the timer spy observes scheduled timers and forgets cleared ones', () => {
    const { scheduled, restore } = spyOnTimers()
    const id = setInterval(() => {}, 1000)
    const observed = [...scheduled.values()]
    clearInterval(id)
    const remaining = scheduled.size
    restore()
    expect(observed).toEqual([{ kind: 'interval', delay: 1000 }])
    expect(remaining).toBe(0)
  })

  test.each(Object.entries(connectionParks))('%s holds open without scheduling a timer', async (_name, park) => {
    const { stillParked, timers } = await observePark(park)
    expect(stillParked).toBe(true)
    expect(timers).toEqual([])
  })
})
