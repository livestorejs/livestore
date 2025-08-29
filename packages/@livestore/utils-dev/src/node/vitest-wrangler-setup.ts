import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { Effect, UnknownError } from '@livestore/utils/effect'

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
// TODO allow for config to be passed in via code instead of `wrangler.toml` file
// TODO fix zombie workerd processes causing high CPU usage - see https://github.com/livestorejs/livestore/issues/568
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
}: {
  wranglerConfigPath?: string
  abortSignal?: AbortSignal
  cwd: string
  port?: number
}) => {
  let wranglerProcess: ReturnType<typeof spawn> | undefined

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

    wranglerProcess.stdout?.on('data', (data: string) => {
      // console.log(`[wrangler] ${data}`)
      console.log(data)
    })

    wranglerProcess.stderr?.on('data', (data: string) => {
      // console.error(`[wrangler] ${data}`)
      console.error(data)
    })

    await new Promise<void>((resolve) => {
      const onData = (data: string) => {
        if (data.includes('Ready on')) {
          wranglerProcess?.stdout?.off('data', onData)
          resolve()
        }
      }
      wranglerProcess?.stdout?.on('data', onData)
    })

    console.log(`Wrangler dev server ready on port ${syncPort}`)

    // Wait longer for the Cloudflare Workers runtime to fully initialize
    // console.log('Waiting for Cloudflare Workers runtime to fully initialize...')
    // await new Promise(resolve => setTimeout(resolve, 10000))

    return { port: syncPort }
  }

  const killWranglerProcess = () => {
    if (wranglerProcess) {
      console.log('Killing wrangler process...')
      wranglerProcess.kill('SIGTERM')
      wranglerProcess = undefined
    }
  }

  process.on('exit', killWranglerProcess)
  process.on('SIGINT', killWranglerProcess)
  process.on('SIGTERM', killWranglerProcess)

  try {
    const { afterAll } = await import('vitest')
    afterAll(() => {
      killWranglerProcess()
    })
  } catch {}

  const { port } = await setup()

  return { port, kill: killWranglerProcess }
}
