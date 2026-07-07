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

    const state: {
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
        if (state.profilingActive === true) {
          throw new Error('CPU profiling is already active')
        }

        if (state.cdpSession == null) {
          state.cdpSession = await page.context().newCDPSession(page)
        }

        await state.cdpSession.send('Profiler.enable')
        await state.cdpSession.send('Profiler.start')
        state.profilingActive = true
        state.currentLabel = label
      },

      stop: async (name: string) => {
        if (state.profilingActive === false || state.cdpSession == null) {
          throw new Error('CPU profiling is not active')
        }

        const { profile } = await state.cdpSession.send('Profiler.stop')
        state.profilingActive = false

        // Save the profile to a file
        const filename =
          state.currentLabel !== undefined ? `${name}-${state.currentLabel}.cpuprofile` : `${name}.cpuprofile`
        const profilePath = testInfo.outputPath(filename)

        const fs = await import('node:fs/promises')
        await fs.writeFile(profilePath, JSON.stringify(profile, null, 2))

        console.log(`CPU profile saved: ${profilePath}`)
        state.currentLabel = undefined
      },

      isActive: () => state.profilingActive,
    }

    await use(profiler)

    // Cleanup: stop profiling if still active
    if (state.profilingActive === true && state.cdpSession !== null) {
      try {
        await state.cdpSession.send('Profiler.stop')
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (state.cdpSession !== null) {
      await state.cdpSession.detach()
    }
  },
})
