#!/usr/bin/env node

import { liveStoreVersion } from '@livestore/common'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel, Console } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { command } from './cli.ts'

const cli = Cli.Command.run(command, {
  name: 'livestore',
  version: liveStoreVersion,
})

const showExperimentalWarning = Console.log('⚠️  Warning: LiveStore CLI is experimental and under active development')

const layer = Layer.mergeAll(
  PlatformNode.NodeContext.layer,
  FetchHttpClient.layer,
  Logger.minimumLogLevel(LogLevel.Info),
)

Effect.gen(function* () {
  yield* showExperimentalWarning
  return yield* cli(process.argv)
}).pipe(
  Effect.provide(layer),
  PlatformNode.NodeRuntime.runMain
)
