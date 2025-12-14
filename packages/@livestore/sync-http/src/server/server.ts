import { Context, Effect, Layer } from '@livestore/utils/effect'
import type { ServerCallbacks, TransportConfig } from '../common/mod.ts'

export type SyncServerConfig = {
  readonly port: number
  readonly host?: string | undefined
  readonly transports?: TransportConfig | undefined
  readonly responseHeaders?: Record<string, string> | undefined
} & ServerCallbacks

export class SyncServerConfigTag extends Context.Tag('SyncServerConfig')<SyncServerConfigTag, SyncServerConfig>() {}

/**
 * The SyncServer service provides the running HTTP/WebSocket server.
 */
export type SyncServer = {
  /** The URL the server is listening on */
  readonly url: string
  /** The port the server is listening on */
  readonly port: number
}

export class SyncServerTag extends Context.Tag('SyncServer')<SyncServerTag, SyncServer>() {}

/**
 * Creates the SyncServer layer that runs the HTTP server.
 * Requires SyncStorage and platform-specific HttpServer layer.
 */
export const SyncServerLive = Layer.scoped(
  SyncServerTag,
  Effect.gen(function* () {
    const config = yield* SyncServerConfigTag
    const host = config.host ?? '0.0.0.0'

    yield* Effect.logInfo(`Starting sync server on ${host}:${config.port}`)

    // The actual HTTP server is started by the platform layer
    // We just return the server info

    return {
      url: `http://${host}:${config.port}`,
      port: config.port,
    } satisfies SyncServer
  }),
)

/**
 * Creates a complete server layer including HTTP app and server lifecycle.
 * This is the main entry point for creating a sync server with Effect.
 */
export const makeSyncServerLayer = (config: SyncServerConfig) =>
  Layer.mergeAll(Layer.succeed(SyncServerConfigTag, config), SyncServerLive)
