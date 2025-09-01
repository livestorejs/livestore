import { Command, type CommandExecutor, Effect, Schema, type Scope, Stream } from '@livestore/utils/effect'

export class ProcessTreeError extends Schema.TaggedError<ProcessTreeError>()('ProcessTreeError', {
  cause: Schema.Unknown,
  message: Schema.String,
  pid: Schema.Number,
}) {}

/**
 * Finds all child processes of a given parent PID
 */
export const findChildProcesses = (
  parentPid: number,
): Effect.Effect<number[], never, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const result = yield* Command.make('ps', '-o', 'pid,ppid', '-ax').pipe(
      Command.start,
      Effect.flatMap((command) =>
        command.stdout.pipe(
          Stream.decodeText('utf8'),
          Stream.runCollect,
          Effect.map((chunks) => Array.from(chunks).join('')),
        ),
      ),
      Effect.catchAll(() => Effect.succeed('')), // Return empty string if command fails
    )

    if (!result) return []

    const lines = result.split('\n')
    const pattern = new RegExp(`^\\s*([0-9]+)\\s+${parentPid}\\s*$`)

    const childPids = lines
      .map((line) => {
        const match = line.trim().match(pattern)
        return match ? Number.parseInt(match[1]!, 10) : null
      })
      .filter((pid): pid is number => pid !== null)

    return childPids
  })

/**
 * Recursively finds all descendants of a process
 */
export const findProcessTree = (
  rootPid: number,
): Effect.Effect<number[], never, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const allPids = new Set<number>([rootPid])
    const toProcess = [rootPid]

    while (toProcess.length > 0) {
      const currentPid = toProcess.pop()!
      const children = yield* findChildProcesses(currentPid)

      for (const childPid of children) {
        if (!allPids.has(childPid)) {
          allPids.add(childPid)
          toProcess.push(childPid)
        }
      }
    }

    return Array.from(allPids)
  })

/**
 * Checks if a process is running
 */
export const isProcessRunning = (pid: number): Effect.Effect<boolean, never, never> =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })

/**
 * Kills a process tree with escalating signals
 */
export const killProcessTree = (
  rootPid: number,
  options: {
    timeout?: number
    signals?: NodeJS.Signals[]
    includeRoot?: boolean
  } = {},
): Effect.Effect<
  { killedPids: number[]; failedPids: number[] },
  never,
  CommandExecutor.CommandExecutor | Scope.Scope
> =>
  Effect.gen(function* () {
    const { timeout = 5000, signals = ['SIGTERM', 'SIGKILL'], includeRoot = true } = options

    // Find all processes in the tree
    const allPids = yield* findProcessTree(rootPid)
    const pidsToKill = includeRoot ? allPids : allPids.filter((pid) => pid !== rootPid)

    if (pidsToKill.length === 0) {
      return { killedPids: [], failedPids: [] }
    }

    const killedPids: number[] = []
    const failedPids: number[] = []

    // Try each signal with timeout
    for (const signal of signals) {
      // Check which processes are still running and not yet killed
      const stillRunningChecks = yield* Effect.all(
        pidsToKill
          .filter((pid) => !killedPids.includes(pid))
          .map((pid) => isProcessRunning(pid).pipe(Effect.map((running) => ({ pid, running })))),
      )
      const remainingPids = stillRunningChecks.filter(({ running }) => running).map(({ pid }) => pid)

      if (remainingPids.length === 0) break

      // Send signal to all remaining processes
      for (const pid of remainingPids) {
        yield* Effect.sync(() => {
          try {
            process.kill(pid, signal)
          } catch {
            // Process might already be dead, continue
          }
        })
      }

      // Wait for processes to terminate with polling
      const waitStart = Date.now()
      while (Date.now() - waitStart < timeout) {
        const runningChecks = yield* Effect.all(
          remainingPids.map((pid) => isProcessRunning(pid).pipe(Effect.map((running) => ({ pid, running })))),
        )
        const stillRunning = runningChecks.filter(({ running }) => running).map(({ pid }) => pid)

        if (stillRunning.length === 0) {
          // All processes terminated
          killedPids.push(...remainingPids)
          break
        }

        // Short sleep before checking again
        yield* Effect.sleep('100 millis')
      }
    }

    // Check final status
    const finalChecks = yield* Effect.all(
      pidsToKill.map((pid) => isProcessRunning(pid).pipe(Effect.map((running) => ({ pid, running })))),
    )

    for (const { pid, running } of finalChecks) {
      if (!killedPids.includes(pid) && running) {
        failedPids.push(pid)
      }
    }

    return { killedPids, failedPids }
  })

/**
 * Finds orphaned processes by name pattern
 */
export const findOrphanedProcesses = (
  namePattern: string,
): Effect.Effect<number[], never, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    // Find processes that match the pattern and have init (PID 1) as parent
    const result = yield* Command.make('ps', '-eo', 'pid,ppid,comm').pipe(
      Command.start,
      Effect.flatMap((command) =>
        command.stdout.pipe(
          Stream.decodeText('utf8'),
          Stream.runCollect,
          Effect.map((chunks) => Array.from(chunks).join('')),
        ),
      ),
      Effect.catchAll(() => Effect.succeed('')), // Return empty string if command fails
    )

    if (!result) return []

    const lines = result.split('\n')
    const patternRegex = new RegExp(namePattern)
    const parentRegex = /^\s*(\d+)\s+1\s+/

    const orphanedPids = lines
      .filter((line) => patternRegex.test(line))
      .map((line) => {
        const match = line.trim().match(parentRegex)
        return match ? Number.parseInt(match[1]!, 10) : null
      })
      .filter((pid): pid is number => pid !== null)

    return orphanedPids
  })

/**
 * Defensive cleanup for orphaned processes matching given patterns.
 *
 * This function provides fallback cleanup for edge cases where normal process
 * termination mechanisms fail (e.g., hard crashes, SIGKILL before cleanup runs,
 * or limitations in synchronous exit handlers). While proper process tree cleanup
 * should prevent orphans in most cases, this serves as a safety net for scenarios
 * where child processes become orphaned despite cleanup efforts.
 *
 * @param processPatterns - Array of process name patterns to search for (e.g., ['wrangler', 'workerd'])
 * @returns Object with arrays of successfully cleaned and failed PIDs
 */
export const cleanupOrphanedProcesses = (
  processPatterns: string[],
): Effect.Effect<{ cleaned: number[]; failed: number[] }, never, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const cleaned: number[] = []
    const failed: number[] = []

    // Find all orphaned processes matching the patterns
    const allOrphanedPids: number[] = []
    const patternCounts: Record<string, number> = {}

    for (const pattern of processPatterns) {
      const orphaned = yield* findOrphanedProcesses(pattern)
      allOrphanedPids.push(...orphaned)
      patternCounts[pattern] = orphaned.length
    }

    if (allOrphanedPids.length === 0) {
      return { cleaned, failed }
    }

    const patternSummary = Object.entries(patternCounts)
      .map(([pattern, count]) => `${count} ${pattern}`)
      .join(', ')

    yield* Effect.logInfo(
      `Found ${allOrphanedPids.length} orphaned processes (${patternSummary}): ${allOrphanedPids.join(', ')}`,
    )

    for (const pid of allOrphanedPids) {
      const result = yield* killProcessTree(pid, {
        timeout: 2000,
        signals: ['SIGTERM', 'SIGKILL'],
        includeRoot: true,
      }).pipe(Effect.orElse(() => Effect.succeed({ killedPids: [], failedPids: [pid] })))

      if (result.failedPids.length === 0) {
        cleaned.push(...result.killedPids)
        yield* Effect.logInfo(
          `Cleaned up orphaned process tree starting with ${pid} (${result.killedPids.length} processes)`,
        )
      } else {
        failed.push(pid, ...result.failedPids)
        yield* Effect.logWarning(`Failed to clean up some processes in tree ${pid}: ${result.failedPids.join(', ')}`)
      }
    }

    return { cleaned, failed }
  })
