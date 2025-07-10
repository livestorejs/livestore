import path from 'node:path'
import { shouldNeverHappen, sluggify } from '@livestore/utils'
import { cuid } from '@livestore/utils/cuid'
import { Layer } from '@livestore/utils/effect'
import { FileLogger } from '@livestore/utils-dev/node'
import type { Vitest } from '@livestore/utils-dev/node-vitest'

/** Expects TEST_RUN_ID to be set by Vitest */
export const makeFileLogger = (threadName: string, exposeTestContext?: { testContext: Vitest.TestContext }) =>
  Layer.suspend(() => {
    if (exposeTestContext !== undefined) {
      const spanName = `${exposeTestContext.testContext.task.suite?.name}:${exposeTestContext.testContext.task.name}`
      process.env.TEST_RUN_ID = `${cuid()}-${sluggify(spanName)}`
    }

    const testRunId = process.env.TEST_RUN_ID ?? shouldNeverHappen(`TEST_RUN_ID is not set (threadName: ${threadName})`)

    const logFilePath = path.join(
      process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set (threadName: ${threadName})`),
      'tests',
      'integration',
      'tmp',
      'logs',
      testRunId,
      `${threadName}.log`,
    )

    exposeTestContext?.testContext?.annotate(`Log file: ${logFilePath}`)
    console.log(`[${testRunId}] Log file for ${threadName}: ${logFilePath}`)

    return FileLogger.makeFileLogger(logFilePath, { threadName })
  })
