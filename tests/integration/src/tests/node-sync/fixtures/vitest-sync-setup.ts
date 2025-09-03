import * as ChildProcess from 'node:child_process'

import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { afterAll, beforeAll } from 'vitest'

// Enable experimental push-resume during upstream advance on CI debug branches
const refName = typeof process !== 'undefined' ? process.env.GITHUB_REF_NAME : undefined
const headRef = typeof process !== 'undefined' ? process.env.GITHUB_HEAD_REF : undefined
const branchName = headRef || refName
if (branchName?.startsWith('ci-node-sync-debug')) {
  if (typeof process !== 'undefined' && process.env && process.env.LS_RESUME_PUSH_ON_ADVANCE === undefined) {
    process.env.LS_RESUME_PUSH_ON_ADVANCE = '1'
  }
}

let wranglerProcess: ChildProcess.ChildProcess

beforeAll(async () => {
  const syncPort = await getFreePort.pipe(Effect.runPromise)

  process.env.LIVESTORE_SYNC_PORT = syncPort.toString()

  console.log(`Starting sync backend via \`wrangler dev\` on localhost:${syncPort}`)
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
