import * as ChildProcess from 'node:child_process'
import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { afterAll, beforeAll } from 'vitest'

let wranglerProcess: ChildProcess.ChildProcess

beforeAll(async () => {
  const syncPort = await getFreePort.pipe(Effect.runPromise)

  process.env.LIVESTORE_SYNC_PORT = syncPort.toString()

  // console.log(`Starting sync backend via \`wrangler dev\` on localhost:${syncPort}`)
  wranglerProcess = ChildProcess.spawn('bunx', ['wrangler', 'dev', '--port', syncPort.toString()], {
    stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, pipe stdout and stderr to parent process
    cwd: import.meta.dirname,
  })

  const cleanup = () => {
    if (!wranglerProcess.killed) {
      wranglerProcess.kill()
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await new Promise<void>((resolve) => {
    wranglerProcess.stdout!.on('data', (data: Buffer) => {
      // console.log(data.toString())
      // console.log('cf-worker stdout', data.toString())
      if (data.toString().includes('Ready on')) {
        resolve()
      }
    })
    wranglerProcess.stderr!.on('data', (data: Buffer) => {
      console.error('stderr', data.toString())
    })
  })
})

afterAll(() => {
  wranglerProcess.kill()
})
