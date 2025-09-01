import * as fs from 'node:fs'
import * as os from 'node:os'
import * as process from 'node:process'
import { Command, Effect, Schema } from '@livestore/utils/effect'

/**
 * System resource snapshot
 */
export const SystemSnapshot = Schema.Struct({
  timestamp: Schema.Date,
  memory: Schema.Struct({
    total: Schema.Number,
    free: Schema.Number,
    used: Schema.Number,
    available: Schema.Number,
  }),
  cpu: Schema.Struct({
    loadAverage: Schema.Tuple(Schema.Number, Schema.Number, Schema.Number),
    coreCount: Schema.Number,
  }),
  processes: Schema.Struct({
    total: Schema.Number,
    nodeProcesses: Schema.Number,
  }),
  disk: Schema.optional(
    Schema.Struct({
      free: Schema.Number,
      total: Schema.Number,
    }),
  ),
  env: Schema.Struct({
    isCI: Schema.Boolean,
    nodeVersion: Schema.String,
    platform: Schema.String,
    arch: Schema.String,
  }),
})

export type SystemSnapshot = typeof SystemSnapshot.Type

/**
 * Timing measurement for operations
 */
export const TimingMeasurement = Schema.Struct({
  operation: Schema.String,
  startTime: Schema.Date,
  endTime: Schema.Date,
  durationMs: Schema.Number,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

export type TimingMeasurement = typeof TimingMeasurement.Type

/**
 * Complete diagnostic report
 */
export const DiagnosticReport = Schema.Struct({
  hypothesis: Schema.String,
  runId: Schema.String,
  startTime: Schema.Date,
  endTime: Schema.Date,
  totalDurationMs: Schema.Number,
  systemSnapshots: Schema.Array(SystemSnapshot),
  timings: Schema.Array(TimingMeasurement),
  success: Schema.Boolean,
  conclusion: Schema.optional(Schema.String),
  evidence: Schema.Array(Schema.String),
  recommendations: Schema.Array(Schema.String),
})

export type DiagnosticReport = typeof DiagnosticReport.Type

/**
 * Collect current system resource snapshot
 */
export const collectSystemSnapshot = Effect.fn('collectSystemSnapshot')(function* () {
  const _memInfo = process.memoryUsage()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  // Count processes
  const psOutput = yield* Command.make('ps', 'aux').pipe(
    Command.string,
    Effect.map((output) => output.split('\n').length - 1),
    Effect.catchAll(() => Effect.succeed(-1)),
  )

  const nodeProcesses = yield* Command.make('pgrep', '-c', 'node').pipe(
    Command.string,
    Effect.map((output) => Number.parseInt(output.trim(), 10)),
    Effect.catchAll(() => Effect.succeed(-1)),
  )

  // Get disk info if possible
  const diskInfo = yield* Command.make('df', '-h', '.').pipe(
    Command.string,
    Effect.map((output) => {
      const lines = output.split('\n')
      if (lines.length > 1) {
        const parts = lines[1]?.split(/\s+/) ?? []
        return {
          total: Number.parseFloat(parts[1] ?? '0') || -1,
          free: Number.parseFloat(parts[3] ?? '0') || -1,
        }
      }
      return undefined
    }),
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

  return {
    timestamp: new Date(),
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      available: freeMem,
    },
    cpu: {
      loadAverage: os.loadavg().slice(0, 3) as unknown as readonly [number, number, number],
      coreCount: os.cpus().length,
    },
    processes: {
      total: psOutput,
      nodeProcesses: nodeProcesses,
    },
    disk: diskInfo,
    env: {
      isCI: process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true',
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
  } satisfies SystemSnapshot
})

/**
 * Measure timing of an operation
 */
export const measureTiming = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
  metadata?: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const startTime = new Date()
    const start = Date.now()

    const result = yield* effect.pipe(Effect.exit)

    const endTime = new Date()
    const durationMs = Date.now() - start

    const measurement: TimingMeasurement = {
      operation,
      startTime,
      endTime,
      durationMs,
      success: result._tag === 'Success',
      error: result._tag === 'Failure' ? String(result.cause) : undefined,
      metadata,
    }

    yield* Effect.log(`⏱️  ${operation}: ${durationMs}ms (${result._tag})`)

    // Return both the measurement and the original result
    return { measurement, result }
  })

/**
 * Log system information for debugging
 */
export const logSystemInfo = Effect.fn('logSystemInfo')(function* () {
  const snapshot = yield* collectSystemSnapshot()

  yield* Effect.log('🖥️  System Info', {
    memory: `${Math.round(snapshot.memory.used / 1024 / 1024)}MB / ${Math.round(snapshot.memory.total / 1024 / 1024)}MB`,
    cpu: `${snapshot.cpu.coreCount} cores, load: [${snapshot.cpu.loadAverage.map((l: number) => l.toFixed(2)).join(', ')}]`,
    processes: `${snapshot.processes.total} total, ${snapshot.processes.nodeProcesses} node`,
    env: `${snapshot.env.platform}-${snapshot.env.arch}, Node ${snapshot.env.nodeVersion}, CI: ${snapshot.env.isCI}`,
  })

  return snapshot
})

/**
 * Write diagnostic report to file
 */
export const writeDiagnosticReport = (report: DiagnosticReport, filePath: string) =>
  Effect.fn('writeDiagnosticReport')(function* () {
    const reportJson = JSON.stringify(report, null, 2)

    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    yield* Effect.try({
      try: () => fs.mkdirSync(dir, { recursive: true }),
      catch: (error) => new Error(`Failed to create directory ${dir}: ${error}`),
    })

    // Write report
    yield* Effect.try({
      try: () => fs.writeFileSync(filePath, reportJson),
      catch: (error) => new Error(`Failed to write report to ${filePath}: ${error}`),
    })

    yield* Effect.log(`📊 Diagnostic report written to: ${filePath}`)
  })

/**
 * Generate markdown summary from diagnostic report
 */
export const generateMarkdownSummary = (report: DiagnosticReport): string => {
  const {
    hypothesis,
    runId,
    totalDurationMs,
    success,
    timings,
    systemSnapshots,
    conclusion,
    evidence,
    recommendations,
  } = report

  const firstSnapshot = systemSnapshots[0]
  const _lastSnapshot = systemSnapshots[systemSnapshots.length - 1]

  let md = `# ${hypothesis} Investigation Report\n\n`
  md += `**Run ID:** ${runId}\n`
  md += `**Duration:** ${totalDurationMs}ms\n`
  md += `**Status:** ${success ? '✅ SUCCESS' : '❌ FAILED'}\n`
  md += `**Environment:** ${firstSnapshot?.env.isCI ? 'CI' : 'Local'}\n\n`

  // System info
  if (firstSnapshot) {
    md += `## System Information\n\n`
    md += `- **Platform:** ${firstSnapshot.env.platform}-${firstSnapshot.env.arch}\n`
    md += `- **Node:** ${firstSnapshot.env.nodeVersion}\n`
    md += `- **CPU:** ${firstSnapshot.cpu.coreCount} cores\n`
    md += `- **Memory:** ${Math.round(firstSnapshot.memory.total / 1024 / 1024)}MB total\n\n`
  }

  // Timing breakdown
  md += `## Timing Breakdown\n\n`
  md += `| Operation | Duration | Status |\n`
  md += `|-----------|----------|--------|\n`

  for (const timing of timings) {
    const status = timing.success ? '✅' : '❌'
    md += `| ${timing.operation} | ${timing.durationMs}ms | ${status} |\n`
  }
  md += `\n`

  // Resource usage over time
  if (systemSnapshots.length > 1) {
    md += `## Resource Usage\n\n`
    md += `| Time | Memory Used | Load Avg | Processes |\n`
    md += `|------|-------------|----------|----------|\n`

    systemSnapshots.forEach((snapshot, i) => {
      const relativeTime =
        i === 0 ? '0s' : `${Math.round((snapshot.timestamp.getTime() - firstSnapshot!.timestamp.getTime()) / 1000)}s`
      const memUsed = Math.round(snapshot.memory.used / 1024 / 1024)
      const loadAvg = snapshot.cpu.loadAverage[0].toFixed(2)
      md += `| ${relativeTime} | ${memUsed}MB | ${loadAvg} | ${snapshot.processes.total} |\n`
    })
    md += `\n`
  }

  // Evidence
  if (evidence.length > 0) {
    md += `## Evidence\n\n`
    evidence.forEach((item) => {
      md += `- ${item}\n`
    })
    md += `\n`
  }

  // Conclusion
  if (conclusion) {
    md += `## Conclusion\n\n`
    md += `${conclusion}\n\n`
  }

  // Recommendations
  if (recommendations.length > 0) {
    md += `## Recommendations\n\n`
    recommendations.forEach((rec) => {
      md += `- ${rec}\n`
    })
    md += `\n`
  }

  return md
}

/**
 * Create a minimal test timing harness
 */
export const createTimingHarness = <A, E, R>(operation: string, testEffect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const runId = `${operation}-${Date.now()}`
    const startSnapshot = yield* collectSystemSnapshot()
    const allTimings: TimingMeasurement[] = []
    const allSnapshots: SystemSnapshot[] = [startSnapshot]

    let finalResult: unknown
    let success = false

    // Wrap the test in timing measurement
    const { measurement, result } = yield* measureTiming(operation, testEffect)
    allTimings.push(measurement)

    if (result._tag === 'Success') {
      success = true
      finalResult = result.value
    } else {
      yield* Effect.logError(`Operation failed: ${result.cause}`)
    }

    const endSnapshot = yield* collectSystemSnapshot()
    allSnapshots.push(endSnapshot)

    const report: DiagnosticReport = {
      hypothesis: operation,
      runId,
      startTime: startSnapshot.timestamp,
      endTime: endSnapshot.timestamp,
      totalDurationMs: endSnapshot.timestamp.getTime() - startSnapshot.timestamp.getTime(),
      systemSnapshots: allSnapshots,
      timings: allTimings,
      success,
      conclusion: undefined,
      evidence: [],
      recommendations: [],
    }

    return { report, result: finalResult, success }
  })
