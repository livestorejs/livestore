import { spawn } from 'node:child_process'

import { beforeAll } from 'vitest'

beforeAll(async () => {
  const wranglerProcess = spawn('bunx', ['wrangler', 'dev', '--port', '8888'], {
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
    wranglerProcess.stdout.on('data', (data: Buffer) => {
      // console.log('data', data.toString())
      if (data.toString().includes('Ready on')) {
        resolve()
      }
    })
    wranglerProcess.stderr.on('data', (data: Buffer) => {
      console.error('stderr', data.toString())
    })
  })
})
