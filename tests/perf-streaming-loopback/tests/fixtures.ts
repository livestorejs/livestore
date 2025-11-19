import { test as base, type CDPSession } from '@playwright/test'

/**
 * CPU profiler utility for capturing detailed performance profiles
 * using Chrome DevTools Protocol.
 */
type CPUProfiler = {
  /** Start CPU profiling with an optional label */
  start: (label?: string) => Promise<void>
  /** Stop CPU profiling and save the profile with the given name */
  stop: (name: string) => Promise<void>
  /** Check if profiling is currently active */
  isActive: () => boolean
}

export const test = base.extend<{
  forEachTest: undefined
  cpuProfiler: CPUProfiler
}>({
  forEachTest: [
    async ({ page, browser }, use, testInfo) => {
      const shouldRecordPerfProfile = process.env.PERF_PROFILER === '1'
      if (shouldRecordPerfProfile) {
        await browser.startTracing(page, { path: testInfo.outputPath('perf-profile.json') })
      }

      await use(undefined)

      if (shouldRecordPerfProfile) {
        await browser.stopTracing()
      }
    },
    { auto: true },
  ],

  cpuProfiler: async ({ page }, use, testInfo) => {
    const shouldProfile = process.env.CPU_PROFILER === '1'

    if (!shouldProfile) {
      // Provide a no-op profiler when CPU profiling is disabled
      const noopProfiler: CPUProfiler = {
        start: async () => {},
        stop: async () => {},
        isActive: () => false,
      }
      await use(noopProfiler)
      return
    }

    let cdpSession: CDPSession | null = null
    let profilingActive = false
    let currentLabel: string | undefined

    const profiler: CPUProfiler = {
      start: async (label?: string) => {
        if (profilingActive) {
          throw new Error('CPU profiling is already active')
        }

        if (!cdpSession) {
          cdpSession = await page.context().newCDPSession(page)
        }

        await cdpSession.send('Profiler.enable')
        await cdpSession.send('Profiler.start')
        profilingActive = true
        currentLabel = label
      },

      stop: async (name: string) => {
        if (!profilingActive || !cdpSession) {
          throw new Error('CPU profiling is not active')
        }

        const { profile } = await cdpSession.send('Profiler.stop')
        profilingActive = false

        // Save the profile to a file
        const filename = currentLabel ? `${name}-${currentLabel}.cpuprofile` : `${name}.cpuprofile`
        const profilePath = testInfo.outputPath(filename)

        const fs = await import('node:fs/promises')
        await fs.writeFile(profilePath, JSON.stringify(profile, null, 2))

        console.log(`CPU profile saved: ${profilePath}`)
        currentLabel = undefined
      },

      isActive: () => profilingActive,
    }

    await use(profiler)

    // Cleanup: stop profiling if still active
    if (profilingActive && cdpSession) {
      try {
        await cdpSession.send('Profiler.stop')
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (cdpSession) {
      await cdpSession.detach()
    }
  },
})
