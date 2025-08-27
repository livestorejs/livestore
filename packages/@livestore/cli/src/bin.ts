#!/usr/bin/env node

import { liveStoreVersion } from '@livestore/common'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { command } from './cli.ts'

const cli = Cli.Command.run(command, {
  name: 'livestore',
  version: liveStoreVersion,
})

const layer = Layer.mergeAll(
  PlatformNode.NodeContext.layer,
  FetchHttpClient.layer,
  Logger.minimumLogLevel(LogLevel.Info),
)

cli(process.argv).pipe(Effect.provide(layer), PlatformNode.NodeRuntime.runMain)
