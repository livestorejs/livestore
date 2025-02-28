// eslint-disable-next-line unicorn/prefer-node-protocol
import * as ChildProcess from 'child_process'
import { afterAll, beforeAll } from 'vitest'

let wranglerProcess: ChildProcess.ChildProcess

beforeAll(async () => {
  ChildProcess.execSync('lsof -ti :8888 | xargs kill -9 || true')

  console.log('Starting sync backend via `wrangler dev` on localhost:8888')
  wranglerProcess = ChildProcess.spawn('bunx', ['wrangler', 'dev', '--port', '8888'], {
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
