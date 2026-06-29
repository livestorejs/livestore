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
      if (shouldRecordPerfProfile === true) {
        await browser.startTracing(page, { path: testInfo.outputPath('perf-profile.json') })
      }

      await use(undefined)

      if (shouldRecordPerfProfile === true) {
        await browser.stopTracing()
      }
    },
    { auto: true },
  ],

  cpuProfiler: async ({ page }, use, testInfo) => {
    const shouldProfile = process.env.CPU_PROFILER === '1'

    if (shouldProfile === false) {
      // Provide a no-op profiler when CPU profiling is disabled
      const noopProfiler: CPUProfiler = {
        start: async () => {},
        stop: async () => {},
        isActive: () => false,
      }
      await use(noopProfiler)
      return
    }

    const profilerState: {
      cdpSession: CDPSession | null
      profilingActive: boolean
      currentLabel: string | undefined
    } = {
      cdpSession: null,
      profilingActive: false,
      currentLabel: undefined,
    }

    const profiler: CPUProfiler = {
      start: async (label?: string) => {
        if (profilerState.profilingActive === true) {
          throw new Error('CPU profiling is already active')
        }

        let session = profilerState.cdpSession
        if (session == null) {
          session = await page.context().newCDPSession(page)
          profilerState.cdpSession = session
        }

        await session.send('Profiler.enable')
        await session.send('Profiler.start')
        profilerState.profilingActive = true
        profilerState.currentLabel = label
      },

      stop: async (name: string) => {
        const session = profilerState.cdpSession
        if (profilerState.profilingActive === false || session == null) {
          throw new Error('CPU profiling is not active')
        }

        const { profile } = await session.send('Profiler.stop')
        profilerState.profilingActive = false

        // Save the profile to a file
        const filename =
          profilerState.currentLabel !== undefined
            ? `${name}-${profilerState.currentLabel}.cpuprofile`
            : `${name}.cpuprofile`
        const profilePath = testInfo.outputPath(filename)

        const fs = await import('node:fs/promises')
        await fs.writeFile(profilePath, JSON.stringify(profile, null, 2))

        console.log(`CPU profile saved: ${profilePath}`)
        profilerState.currentLabel = undefined
      },

      isActive: () => profilerState.profilingActive,
    }

    await use(profiler)

    // Cleanup: stop profiling if still active
    const session = profilerState.cdpSession
    if (profilerState.profilingActive === true && session != null) {
      try {
        await session.send('Profiler.stop')
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (session != null) {
      await session.detach()
    }
  },
})
