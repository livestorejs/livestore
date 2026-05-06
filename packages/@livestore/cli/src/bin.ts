#!/usr/bin/env node

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { liveStoreVersion } from '@livestore/common'
import { Console, Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { command } from './cli.ts'

const cli = Cli.Command.run(command, {
  name: 'livestore',
  version: liveStoreVersion,
})

const showExperimentalWarning = Console.log('⚠️  Warning: LiveStore CLI is experimental and under active development')

const layer = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  Logger.minimumLogLevel('Info'),
)

Effect.gen(function* () {
  yield* showExperimentalWarning
  return yield* cli(process.argv)
}).pipe(Effect.provide(layer), NodeRuntime.runMain)
