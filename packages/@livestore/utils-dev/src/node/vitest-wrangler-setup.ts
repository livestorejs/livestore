import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

import { Effect, UnknownError } from '@livestore/utils/effect'

import { cleanupOrphanedProcesses, killProcessTree } from './process-tree-manager.ts'

export type StartWranglerDevServerArgs = {
  wranglerConfigPath?: string
  cwd: string
  port?: number
}

export const startWranglerDevServer = (args: StartWranglerDevServerArgs) =>
  Effect.tryPromise({
    try: (abortSignal) => startWranglerDevServerPromise({ ...args, abortSignal }),
    catch: (error) => UnknownError.make({ cause: new Error(`Failed to start Wrangler: ${error}`) }),
  }).pipe(Effect.withSpan('startWranglerDevServer'))

// TODO refactor implementation with Effect
// TODO add test for this
// TODO allow for config to be passed in via code instead of `wrangler.toml` file (would need to be placed in temporary file as wrangler only accept files as config)
/**
 * Starts a Wrangler dev server for testing with automatic cleanup.
 *
 * @param wranglerConfigPath - Path to wrangler.toml file (defaults to `${cwd}/wrangler.toml`)
 * @param cwd - Working directory for Wrangler commands
 * @returns Object with allocated port for the dev server
 */
export const startWranglerDevServerPromise = async ({
  wranglerConfigPath,
  abortSignal,
  cwd,
  port: inputPort,
  stdout = 'ignore',
  stderr = 'ignore',
}: {
  wranglerConfigPath?: string
  abortSignal?: AbortSignal
  cwd: string
  port?: number
  /** @default 'ignore' */
  stdout?: 'inherit' | 'ignore'
  /** @default 'ignore' */
  stderr?: 'inherit' | 'ignore'
}) => {
  let wranglerProcess: ReturnType<typeof spawn> | undefined

  // Enhanced abort signal handling for immediate cleanup
  const killWranglerProcess = async (immediate = false) => {
    if (wranglerProcess?.pid) {
      console.log('Killing wrangler process...')

      try {
        // Kill the entire process tree (wrangler + workerd children)
        // Use shorter timeout for immediate cancellation scenarios
        const result = await killProcessTree(wranglerProcess.pid, {
          timeout: immediate ? 500 : 3000, // 500ms for abort, 3s for normal cleanup
          signals: ['SIGTERM', 'SIGKILL'],
          includeRoot: true,
        })

        if (result.failedPids.length > 0) {
          console.warn(`Failed to kill some processes: ${result.failedPids.join(', ')}`)
        } else {
          console.log(`Successfully cleaned up wrangler and ${result.killedPids.length - 1} child processes`)
        }
      } catch (error) {
        console.warn('Error during enhanced cleanup, falling back to basic kill:', error)
        // Fallback to basic kill
        wranglerProcess.kill('SIGKILL')
      }

      wranglerProcess = undefined
    }
  }

  // Set up abort signal handler early for immediate response
  if (abortSignal) {
    abortSignal.addEventListener(
      'abort',
      () => {
        console.log('Abort signal received, cleaning up wrangler process immediately...')
        killWranglerProcess(true).catch(console.error) // Use immediate=true for fast cancellation
      },
      { once: true },
    )
  }

  const getFreePort = (): Promise<number> => {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo)?.port
        server.close(() => {
          if (port) {
            resolve(port)
          } else {
            reject(new Error('Could not get port'))
          }
        })
      })
      server.on('error', reject)
    })
  }

  const setup = async () => {
    // Clean up any orphaned workerd processes before starting
    try {
      await cleanupOrphanedProcesses(['wrangler', 'workerd'])
    } catch (error) {
      console.warn('Failed to clean up orphaned workerd processes:', error)
    }

    const syncPort = inputPort ?? (await getFreePort())

    const resolvedWranglerConfigPath = path.resolve(wranglerConfigPath ?? path.join(cwd, 'wrangler.toml'))

    wranglerProcess = spawn(
      'bunx',
      ['wrangler', 'dev', '--port', syncPort.toString(), '--config', resolvedWranglerConfigPath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
        env: {
          ...process.env,
          // NODE_OPTIONS: '--inspect --inspect-port=9233',
        },
        signal: abortSignal,
      },
    )

    wranglerProcess.stdout?.setEncoding('utf8')
    wranglerProcess.stderr?.setEncoding('utf8')

    // Handle process exit/error events for cleanup
    wranglerProcess.on('exit', (_code, signal) => {
      if (signal) {
        console.log(`Wrangler process exited with signal: ${signal}`)
      }
      wranglerProcess = undefined
    })

    wranglerProcess.on('error', (error) => {
      console.warn('Wrangler process error:', error.message)
    })

    if (stdout === 'inherit') {
      wranglerProcess.stdout?.on('data', (data: string) => {
        // console.log(`[wrangler] ${data}`)
        console.log(data)
      })
    }

    if (stderr === 'inherit') {
      wranglerProcess.stderr?.on('data', (data: string) => {
        // console.error(`[wrangler] ${data}`)
        console.error(data)
      })
    }

    await new Promise<void>((resolve) => {
      const onData = (data: string) => {
        if (data.includes('Ready on')) {
          wranglerProcess?.stdout?.off('data', onData)
          resolve()
        }
      }
      wranglerProcess?.stdout?.on('data', onData)
    })

    if (stdout === 'inherit') {
      console.log(`Wrangler dev server ready on port ${syncPort}`)
    }

    // Wait longer for the Cloudflare Workers runtime to fully initialize
    // console.log('Waiting for Cloudflare Workers runtime to fully initialize...')
    // await new Promise(resolve => setTimeout(resolve, 10000))

    return { port: syncPort }
  }

  // Wrap async cleanup for process events
  const syncKillWrangler = () => {
    // For synchronous event handlers, we can't wait for async cleanup
    // but we can at least try the basic kill
    if (wranglerProcess?.pid) {
      try {
        wranglerProcess.kill('SIGKILL')
        wranglerProcess = undefined
      } catch {
        // Process might already be dead
      }
    }
  }

  process.on('exit', syncKillWrangler)
  process.on('SIGINT', syncKillWrangler)
  process.on('SIGTERM', syncKillWrangler)

  try {
    const { afterAll } = await import('vitest')
    afterAll(async () => {
      await killWranglerProcess()
    })
  } catch {}

  const { port } = await setup()

  return { port, kill: killWranglerProcess }
}
