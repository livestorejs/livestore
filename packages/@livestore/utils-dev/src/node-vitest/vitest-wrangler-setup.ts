import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

import { afterAll } from 'vitest'

export const startWranglerDevServer = async ({
  wranglerConfigPath,
  cwd,
}: {
  wranglerConfigPath?: string
  cwd: string
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
    const syncPort = await getFreePort()
    process.env.LIVESTORE_SYNC_PORT = syncPort.toString()

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

  afterAll(() => {
    killWranglerProcess()
  })

  await setup()
}
