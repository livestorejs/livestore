#!/usr/bin/env node

import { NodeRuntime, NodeServices } from '@effect/platform-node'

import { liveStoreVersion } from '@livestore/common'
import { Console, Effect, FetchHttpClient, Layer, Logger } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { command } from './cli.ts'

const cli = Cli.Command.run(command, {
  version: liveStoreVersion,
})

const showExperimentalWarning = Console.log('⚠️  Warning: LiveStore CLI is experimental and under active development')

const layer = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  Logger.layer([Logger.consolePretty()]),
)

Effect.gen(function* () {
  yield* showExperimentalWarning
  return yield* cli
}).pipe(Effect.provide(layer), NodeRuntime.runMain)
