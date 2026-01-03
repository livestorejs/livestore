import { Effect, Fiber, HashMap, Queue, Ref, type Scope } from '@livestore/utils/effect'

import {
  CheckCompleted,
  type CheckEvent,
  CheckEventPubSub,
  CheckFailed,
  CheckOutput,
  CheckStarted,
  type CheckType,
} from './events.ts'

// --- ANSI color codes ---

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const

// --- Status symbols ---

const symbols = {
  pending: '○',
  running: '●',
  passed: '✓',
  failed: '✗',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const

// --- Check state ---

type CheckState = {
  readonly name: string
  readonly type: CheckType
  readonly status: 'pending' | 'running' | 'passed' | 'failed'
  readonly startTime: number | undefined
  readonly durationMs: number | undefined
  readonly output: string[]
  readonly error: string | undefined
}

// --- Output Renderer ---

export interface OutputRendererOptions {
  /** Stream all output as it comes, prefixed with check name. */
  readonly verbose: boolean
  /** Auto-detected: use GitHub Actions log groups. */
  readonly isCI: boolean
}

/**
 * Create an output renderer that consumes CheckEvents and displays progress.
 * Returns an effect that runs the renderer until all checks complete.
 */
export const createOutputRenderer = (
  checkNames: string[],
  options: OutputRendererOptions,
): Effect.Effect<{ readonly results: HashMap.HashMap<string, CheckState> }, never, CheckEventPubSub | Scope.Scope> =>
  Effect.gen(function* () {
    const { verbose, isCI } = options

    // Initialize state for all checks
    const initialStates = checkNames.map((name): [string, CheckState] => [
      name,
      {
        name,
        type: 'typecheck', // Will be updated when Started event arrives
        status: 'pending',
        startTime: undefined,
        durationMs: undefined,
        output: [],
        error: undefined,
      },
    ])
    const statesRef = yield* Ref.make(HashMap.fromIterable(initialStates))

    // Track completed count
    const completedRef = yield* Ref.make(0)
    const totalChecks = checkNames.length

    // Subscribe to events
    const queue = yield* CheckEventPubSub.subscribeQueue

    // Spinner state for non-CI mode
    let spinnerFrame = 0
    let lastRenderTime = 0

    // Render the current state (non-verbose mode)
    const render = () =>
      Effect.gen(function* () {
        if (verbose || isCI) return // Don't render status in verbose/CI mode

        const states = yield* Ref.get(statesRef)
        const now = Date.now()

        // Throttle renders to avoid flickering
        if (now - lastRenderTime < 100) return
        lastRenderTime = now

        // Move cursor up to overwrite previous output
        const lines = checkNames.length
        if (lines > 0) {
          process.stdout.write(`\x1b[${lines}A`)
        }

        // Render each check
        for (const name of checkNames) {
          const state = HashMap.get(states, name).pipe((opt) => (opt._tag === 'Some' ? opt.value : undefined))
          if (!state) continue

          const line = formatCheckLine(state, spinnerFrame)
          // Clear line and write new content
          process.stdout.write(`\x1b[2K${line}\n`)
        }

        spinnerFrame = (spinnerFrame + 1) % symbols.spinner.length
      })

    // Initial render
    if (!verbose && !isCI) {
      for (const name of checkNames) {
        const state = HashMap.get(yield* Ref.get(statesRef), name)
        if (state._tag === 'Some') {
          console.log(formatCheckLine(state.value, 0))
        }
      }
    }

    // Process events
    const processEvents = Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(queue)

        yield* Ref.update(statesRef, (states) => updateState(states, event))

        // Handle different event types
        if (event instanceof CheckStarted) {
          if (isCI) {
            console.log(`::group::${event.name}`)
          } else if (verbose) {
            console.log(`${colors.cyan}▶${colors.reset} ${event.name}`)
          }
        } else if (event instanceof CheckOutput) {
          if (verbose) {
            const prefix = `${colors.dim}[${event.name}]${colors.reset}`
            const streamColor = event.stream === 'stderr' ? colors.red : ''
            console.log(`${prefix} ${streamColor}${event.line}${colors.reset}`)
          }
          // In non-verbose mode, output is buffered in state
        } else if (event instanceof CheckCompleted) {
          if (isCI) {
            console.log(`::endgroup::`)
            const status = event.success
              ? `${colors.green}✓ passed${colors.reset}`
              : `${colors.red}✗ failed${colors.reset}`
            console.log(`${event.name}: ${status} (${formatDuration(event.durationMs)})`)
          } else if (verbose) {
            const status = event.success
              ? `${colors.green}✓ passed${colors.reset}`
              : `${colors.red}✗ failed${colors.reset}`
            console.log(`${colors.cyan}◀${colors.reset} ${event.name}: ${status} (${formatDuration(event.durationMs)})`)
          }

          const completed = yield* Ref.updateAndGet(completedRef, (n) => n + 1)
          if (completed >= totalChecks) {
            // All checks done, exit the loop
            return
          }
        } else if (event instanceof CheckFailed) {
          // Error message is stored in state, will be displayed at the end
          if (verbose) {
            console.log(`${colors.red}Error in ${event.name}: ${event.error}${colors.reset}`)
          }
        }

        // Re-render progress (throttled)
        yield* render()
      }
    })

    // Run the event processor with a spinner refresh interval
    if (!verbose && !isCI) {
      // Fork a fiber that refreshes the spinner periodically
      const spinnerFiber = yield* Effect.fork(
        Effect.forever(
          Effect.gen(function* () {
            yield* Effect.sleep('100 millis')
            yield* render()
          }),
        ),
      )

      yield* processEvents
      yield* Fiber.interrupt(spinnerFiber)
    } else {
      yield* processEvents
    }

    // Final state
    const finalStates = yield* Ref.get(statesRef)

    // In non-verbose mode, print final status and any failures
    if (!verbose && !isCI) {
      // Final render to show completed states
      process.stdout.write(`\x1b[${checkNames.length}A`)
      for (const name of checkNames) {
        const state = HashMap.get(finalStates, name)
        if (state._tag === 'Some') {
          process.stdout.write(`\x1b[2K${formatCheckLine(state.value, 0)}\n`)
        }
      }
    }

    return { results: finalStates }
  })

/**
 * Update check state based on event.
 */
const updateState = (
  states: HashMap.HashMap<string, CheckState>,
  event: CheckEvent,
): HashMap.HashMap<string, CheckState> => {
  if (event instanceof CheckStarted) {
    return HashMap.modify(states, event.name, (state) => ({
      ...state,
      type: event.check,
      status: 'running' as const,
      startTime: Date.now(),
    }))
  }

  if (event instanceof CheckOutput) {
    return HashMap.modify(states, event.name, (state) => ({
      ...state,
      output: [...state.output, event.line],
    }))
  }

  if (event instanceof CheckCompleted) {
    return HashMap.modify(states, event.name, (state) => ({
      ...state,
      status: event.success ? ('passed' as const) : ('failed' as const),
      durationMs: event.durationMs,
    }))
  }

  if (event instanceof CheckFailed) {
    return HashMap.modify(states, event.name, (state) => ({
      ...state,
      error: event.error,
    }))
  }

  return states
}

/**
 * Format a single check line for display.
 */
const formatCheckLine = (state: CheckState, spinnerFrame: number): string => {
  const { name, status, durationMs } = state

  let symbol: string
  let color: string

  switch (status) {
    case 'pending':
      symbol = symbols.pending
      color = colors.gray
      break
    case 'running':
      symbol = symbols.spinner[spinnerFrame] ?? symbols.running
      color = colors.cyan
      break
    case 'passed':
      symbol = symbols.passed
      color = colors.green
      break
    case 'failed':
      symbol = symbols.failed
      color = colors.red
      break
  }

  const durationStr = durationMs !== undefined ? ` ${colors.dim}(${formatDuration(durationMs)})${colors.reset}` : ''
  const statusStr =
    status === 'running'
      ? `${colors.dim}checking...${colors.reset}`
      : status === 'pending'
        ? ''
        : status === 'passed'
          ? `${colors.dim}passed${colors.reset}`
          : `${colors.dim}failed${colors.reset}`

  return `  ${color}${symbol}${colors.reset} ${name.padEnd(20)} ${statusStr}${durationStr}`
}

/**
 * Format duration in a human-readable way.
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const mins = Math.floor(ms / 60000)
  const secs = ((ms % 60000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}

/**
 * Print a summary of check results.
 */
export const printSummary = (
  results: HashMap.HashMap<string, CheckState>,
  totalDurationMs: number,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const states = Array.from(HashMap.values(results))
    const passed = states.filter((s) => s.status === 'passed').length
    const failed = states.filter((s) => s.status === 'failed').length

    console.log('')

    // Print failed check outputs
    const failedChecks = states.filter((s) => s.status === 'failed')
    for (const check of failedChecks) {
      console.log(`${colors.red}${'─'.repeat(60)}${colors.reset}`)
      console.log(`${colors.red}${colors.bold}${check.name} failed:${colors.reset}`)
      console.log('')
      for (const line of check.output) {
        console.log(line)
      }
      if (check.error) {
        console.log(`${colors.red}${check.error}${colors.reset}`)
      }
      console.log(`${colors.red}${'─'.repeat(60)}${colors.reset}`)
      console.log('')
    }

    // Summary line
    if (failed === 0) {
      console.log(
        `${colors.green}${colors.bold}All ${passed} checks passed${colors.reset} ${colors.dim}(${formatDuration(totalDurationMs)})${colors.reset}`,
      )
    } else {
      console.log(
        `${colors.red}${colors.bold}${failed} check${failed > 1 ? 's' : ''} failed${colors.reset}, ${passed} passed ${colors.dim}(${formatDuration(totalDurationMs)})${colors.reset}`,
      )
    }
  })
