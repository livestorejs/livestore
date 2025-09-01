import '../thread-polyfill.ts'

import { IS_CI } from '@livestore/utils'
import { Duration, Effect, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  collectSystemSnapshot,
  createTimingHarness,
  type DiagnosticReport,
  generateMarkdownSummary,
  logSystemInfo,
  writeDiagnosticReport,
} from './diagnostics/index.ts'
import { makeFileLogger } from './fixtures/file-logger.ts'

// Extended timeout for debugging
const debugTimeout = Duration.toMillis(Duration.minutes(30))

/**
 * Base test context with diagnostic capabilities
 */
export const withDiagnosticCtx = (hypothesisName: string, suffix?: string) =>
  Vitest.makeWithTestCtx({
    suffix: suffix ? `${hypothesisName}-${suffix}` : hypothesisName,
    timeout: debugTimeout,
    makeLayer: (testContext) =>
      Layer.mergeAll(
        makeFileLogger('runner', { testContext }),
        WranglerDevServerService.Default({
          cwd: `${import.meta.dirname}/fixtures`,
          showLogs: true, // Enable verbose logging for debugging
        }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
      ),
    forceOtel: false, // Disable OTEL in CI to reduce overhead
  })

/**
 * Create a hypothesis test with full diagnostic reporting
 */
export const createHypothesisTest = (
  hypothesisName: string,
  description: string,
  testImplementation: Effect.Effect<unknown, unknown, unknown>,
) =>
  Vitest.scopedLive(description, (test) =>
    Effect.gen(function* () {
      yield* Effect.log(`🔬 Starting ${hypothesisName}`)
      yield* logSystemInfo

      const runId = `${hypothesisName}-${Date.now()}`

      // Run the test with timing harness
      const { report, success } = yield* createTimingHarness(hypothesisName, testImplementation)

      // Add environment-specific conclusions
      const enhancedReport: DiagnosticReport = {
        ...report,
        conclusion: success
          ? `${hypothesisName}: Test completed successfully`
          : `${hypothesisName}: Test failed - investigating root cause`,
        evidence: [
          `Environment: ${IS_CI ? 'CI' : 'Local'}`,
          `Total duration: ${report.totalDurationMs}ms`,
          `Success rate: ${success ? '100%' : '0%'}`,
        ],
        recommendations: success
          ? []
          : [
              'Investigate specific failure points',
              'Check resource constraints',
              'Verify configuration in CI environment',
            ],
      }

      // Write detailed report
      const reportPath = `tests/integration/tmp/reports/${runId}-report.json`
      yield* writeDiagnosticReport(enhancedReport, reportPath)

      // Write markdown summary
      const markdownPath = `tests/integration/tmp/reports/${runId}-summary.md`
      const markdownContent = generateMarkdownSummary(enhancedReport)
      yield* Effect.try({
        try: () => {
          const fs = require('node:fs')
          fs.writeFileSync(markdownPath, markdownContent)
        },
        catch: (error) => new Error(`Failed to write markdown summary: ${error}`),
      })

      yield* Effect.log(`📋 Reports written:`)
      yield* Effect.log(`   JSON: ${reportPath}`)
      yield* Effect.log(`   Markdown: ${markdownPath}`)

      if (!success) {
        throw new Error(`${hypothesisName} test failed - see diagnostic report for details`)
      }

      return enhancedReport
    }).pipe(withDiagnosticCtx(hypothesisName)(test)),
  )

/**
 * Environment check utilities
 */
export const environmentChecks = {
  /**
   * Verify we're running in the expected environment
   */
  verifyEnvironment: Effect.fn('verifyEnvironment')(
    Effect.gen(function* () {
      const snapshot = yield* collectSystemSnapshot

      yield* Effect.log('🔍 Environment Verification', {
        isCI: snapshot.env.isCI,
        platform: snapshot.env.platform,
        nodeVersion: snapshot.env.nodeVersion,
        availableMemory: `${Math.round(snapshot.memory.available / 1024 / 1024)}MB`,
        cpuCores: snapshot.cpu.coreCount,
      })

      // Check for common CI issues
      if (snapshot.env.isCI) {
        if (snapshot.memory.available < 1024 * 1024 * 1024) {
          // Less than 1GB
          yield* Effect.logWarning('⚠️ Low memory available in CI')
        }

        if (snapshot.cpu.loadAverage[0] > snapshot.cpu.coreCount * 2) {
          yield* Effect.logWarning('⚠️ High CPU load detected')
        }
      }

      return snapshot
    }),
  ),

  /**
   * Check for orphaned processes
   */
  checkOrphanedProcesses: Effect.fn('checkOrphanedProcesses')(
    Effect.gen(function* () {
      const wranglerProcs = yield* Effect.try({
        try: () => {
          const { execSync } = require('node:child_process')
          return execSync('pgrep -f wrangler || true', { encoding: 'utf8' }).trim()
        },
        catch: () => '',
      })

      const workerdProcs = yield* Effect.try({
        try: () => {
          const { execSync } = require('node:child_process')
          return execSync('pgrep -f workerd || true', { encoding: 'utf8' }).trim()
        },
        catch: () => '',
      })

      const orphanCount = [wranglerProcs, workerdProcs].filter((p) => p.length > 0).length

      if (orphanCount > 0) {
        yield* Effect.logWarning(`🧟 Found ${orphanCount} orphaned processes:`, {
          wrangler: wranglerProcs || 'none',
          workerd: workerdProcs || 'none',
        })
      } else {
        yield* Effect.log('✅ No orphaned processes detected')
      }

      return { wranglerProcs, workerdProcs, orphanCount }
    }),
  ),
}
