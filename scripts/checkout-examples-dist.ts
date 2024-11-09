/* eslint-disable unicorn/no-process-exit */
import fs from 'node:fs'
import process from 'node:process'

import { BunContext, BunRuntime } from '@effect/platform-bun'
import { Effect } from 'effect'

import { BunShell, Cli } from './lib.js'

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

// Directories
const DIST_DIR = `${workspaceRoot}/examples/dist`

const checkoutExamplesDist = Effect.gen(function* () {
  if (!fs.existsSync(DIST_DIR)) {
    yield* BunShell.cmd(`git clone git@github.com:livestorejs/examples.git ${DIST_DIR}`)
  }

  const currentBranch = yield* BunShell.cmdText(`git rev-parse --abbrev-ref HEAD`)
  yield* BunShell.cmd(`git checkout ${currentBranch}`, DIST_DIR).pipe(
    Effect.catchAllCause(() => BunShell.cmd(`git checkout -b ${currentBranch}`, DIST_DIR)),
  )

  yield* BunShell.cmd(`git pull`, DIST_DIR)
})

const command = Cli.Command.make('checkout_examples_dist', {}, () => checkoutExamplesDist)

const cli = Cli.Command.run(command, {
  name: 'checkout_examples_dist',
  version: '0.0.1',
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
