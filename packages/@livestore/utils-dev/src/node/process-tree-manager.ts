import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Finds all child processes of a given parent PID
 */
export const findChildProcesses = async (parentPid: number): Promise<number[]> => {
  try {
    // Use ps to find all child processes
    const { stdout } = await execAsync(`ps -o pid,ppid -ax | grep -E "^\\s*[0-9]+\\s+${parentPid}\\s*$"`)

    const childPids = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^\s*(\d+)\s+\d+\s*$/)
        return match ? Number.parseInt(match[1]!, 10) : null
      })
      .filter((pid): pid is number => pid !== null)

    return childPids
  } catch {
    // If command fails, return empty array
    return []
  }
}

/**
 * Recursively finds all descendants of a process
 */
export const findProcessTree = async (rootPid: number): Promise<number[]> => {
  const allPids = new Set<number>([rootPid])
  const toProcess = [rootPid]

  while (toProcess.length > 0) {
    const currentPid = toProcess.pop()!
    const children = await findChildProcesses(currentPid)

    for (const childPid of children) {
      if (!allPids.has(childPid)) {
        allPids.add(childPid)
        toProcess.push(childPid)
      }
    }
  }

  return Array.from(allPids)
}

/**
 * Checks if a process is running
 */
export const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kills a process tree with escalating signals
 */
export const killProcessTree = async (
  rootPid: number,
  options: {
    timeout?: number
    signals?: NodeJS.Signals[]
    includeRoot?: boolean
  } = {},
): Promise<{ killedPids: number[]; failedPids: number[] }> => {
  const { timeout = 5000, signals = ['SIGTERM', 'SIGKILL'], includeRoot = true } = options

  // Find all processes in the tree
  const allPids = await findProcessTree(rootPid)
  const pidsToKill = includeRoot ? allPids : allPids.filter((pid) => pid !== rootPid)

  if (pidsToKill.length === 0) {
    return { killedPids: [], failedPids: [] }
  }

  const killedPids: number[] = []
  const failedPids: number[] = []

  // Try each signal with timeout
  for (const signal of signals) {
    const remainingPids = pidsToKill.filter((pid) => !killedPids.includes(pid) && isProcessRunning(pid))

    if (remainingPids.length === 0) break

    // Send signal to all remaining processes
    for (const pid of remainingPids) {
      try {
        process.kill(pid, signal)
      } catch {
        // Process might already be dead, continue
      }
    }

    // Wait for processes to terminate
    const waitStart = Date.now()
    while (Date.now() - waitStart < timeout) {
      const stillRunning = remainingPids.filter((pid) => isProcessRunning(pid))

      if (stillRunning.length === 0) {
        // All processes terminated
        killedPids.push(...remainingPids)
        break
      }

      // Short sleep before checking again
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // Check final status
  for (const pid of pidsToKill) {
    if (!killedPids.includes(pid) && isProcessRunning(pid)) {
      failedPids.push(pid)
    }
  }

  return { killedPids, failedPids }
}

/**
 * Finds orphaned processes by name pattern
 */
export const findOrphanedProcesses = async (namePattern: string): Promise<number[]> => {
  try {
    // Find processes that match the pattern and have init (PID 1) as parent
    const { stdout } = await execAsync(
      `ps -eo pid,ppid,comm | grep -E "${namePattern}" | grep -E "^\\s*[0-9]+\\s+1\\s+"`,
    )

    const orphanedPids = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^\s*(\d+)\s+1\s+/)
        return match ? Number.parseInt(match[1]!, 10) : null
      })
      .filter((pid): pid is number => pid !== null)

    return orphanedPids
  } catch {
    return []
  }
}

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
export const cleanupOrphanedProcesses = async (
  processPatterns: string[],
): Promise<{ cleaned: number[]; failed: number[] }> => {
  const cleaned: number[] = []
  const failed: number[] = []

  // Find all orphaned processes matching the patterns
  const allOrphanedPids: number[] = []
  const patternCounts: Record<string, number> = {}

  for (const pattern of processPatterns) {
    const orphaned = await findOrphanedProcesses(pattern)
    allOrphanedPids.push(...orphaned)
    patternCounts[pattern] = orphaned.length
  }

  if (allOrphanedPids.length === 0) {
    return { cleaned, failed }
  }

  const patternSummary = Object.entries(patternCounts)
    .map(([pattern, count]) => `${count} ${pattern}`)
    .join(', ')

  console.log(
    `Found ${allOrphanedPids.length} orphaned processes (${patternSummary}): ${allOrphanedPids.join(', ')}`,
  )

  for (const pid of allOrphanedPids) {
    try {
      const result = await killProcessTree(pid, {
        timeout: 2000,
        signals: ['SIGTERM', 'SIGKILL'],
        includeRoot: true,
      })

      if (result.failedPids.length === 0) {
        cleaned.push(...result.killedPids)
        console.log(`Cleaned up orphaned process tree starting with ${pid} (${result.killedPids.length} processes)`)
      } else {
        failed.push(pid, ...result.failedPids)
        console.warn(`Failed to clean up some processes in tree ${pid}: ${result.failedPids.join(', ')}`)
      }
    } catch (error) {
      failed.push(pid)
      console.warn(`Error cleaning up process tree ${pid}:`, error)
    }
  }

  return { cleaned, failed }
}
