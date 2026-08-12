import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import { SearchParamsSchema, SyncHttpRpc } from '@livestore/sync-cf/common'
import { objectToString } from '@livestore/utils'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  type Context,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  KeyValueStore,
  Layer,
  Logger,
  ManagedRuntime,
  References,
  RpcClient,
  RpcSerialization,
  Schema,
  UrlParams,
} from '@livestore/utils/effect'

import { isProviderSelected, providerRegistry } from './providers/registry.ts'
import { SyncProviderImpl, type SyncProviderOptions } from './types.ts'

/** Cloudflare HTTP-specific tests for response headers and HTTP transport features */

const makeFactory = EventFactory.makeFactory(events)
const eventClient = EventFactory.clientIdentity('test-client', 'test-session')

const cloudflareHttpKeys = ['cf-http-d1', 'cf-http-do'] as const
const selectedHttpKeys = cloudflareHttpKeys.filter((key) => isProviderSelected(key))

// When no HTTP provider is selected the full list is still registered, just skipped: an empty
// `describe.each` collects nothing and Vitest fails the file outright, which would red every
// non-HTTP provider cell.
const skipUnlessHttpSelected = selectedHttpKeys.length === 0
const cloudflareHttpProviders = (skipUnlessHttpSelected === true ? cloudflareHttpKeys : selectedHttpKeys).map(
  (key) => providerRegistry[key],
)

type RuntimeServices = SyncProviderImpl | HttpClient.HttpClient

const describeHttpProviders = Vitest.describe.skipIf(skipUnlessHttpSelected).each(cloudflareHttpProviders)

describeHttpProviders('$name HTTP transport', { timeout: 30000 }, ({ layer, name }) => {
  let runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>
  let runtimeContext: Context.Context<RuntimeServices>
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.layer([Logger.consolePretty()])),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, 'Debug')),
        Layer.orDie,
      ),
    )
    runtimeContext = await runtime.context()
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = (testName?: string, options?: SyncProviderOptions, payload?: Schema.Json) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider(
          {
            storeId: `test-store-${name}-${testName}-${testId}`,
            clientId: 'test-client',
            payload,
          },
          options,
        ),
      ).pipe(Effect.provide(runtimeContext)),
    )

  Vitest.live('HTTP responses include custom headers', (test) =>
    Effect.gen(function* () {
      const storeId = `test-store-${name}-${test.task.name}-${testId}`
      const syncBackend = yield* makeProvider(test.task.name)

      expect(syncBackend.metadata.protocol).toBe('http')
      const baseUrl = syncBackend.metadata.url
      const baseUrlString = typeof baseUrl === 'string' ? baseUrl : objectToString(baseUrl)

      // Route the request to the store's DO the same way the real HTTP client does.
      const urlParams = yield* Schema.encodeEffect(SearchParamsSchema)({
        storeId,
        payload: undefined,
        transport: 'http',
      }).pipe(Effect.map(UrlParams.fromInput))

      // Drive a real, correctly-framed Ping through the supported RPC client and read the
      // response headers off its own `transformClient` seam — the hook the client already
      // exposes for request rewriting works just as well for observing the response.
      const captured: { customHeader?: string; version?: string } = {}
      const HttpProtocol = RpcClient.layerProtocolHttp({
        url: baseUrlString,
        transformClient: (client) =>
          client.pipe(
            HttpClient.mapRequest((request) =>
              request.pipe(
                HttpClientRequest.appendUrlParams(urlParams),
                HttpClientRequest.setHeader('x-livestore-store-id', storeId),
              ),
            ),
            HttpClient.tap((response) =>
              Effect.sync(() => {
                captured.customHeader = response.headers['x-custom-header']
                captured.version = response.headers['x-livestore-version']
              }),
            ),
          ),
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const rpcClient = yield* RpcClient.make(SyncHttpRpc).pipe(Effect.provide(HttpProtocol))

      yield* rpcClient['SyncHttpRpc.Ping']({ storeId, payload: undefined })

      expect(captured.customHeader).toBe('test-value')
      expect(captured.version).toBe('1.0.0')
    }).pipe(
      Effect.provide(runtimeContext),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.layer([Logger.consolePretty()]), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )

  Vitest.live('HTTP push threads the client payload through to onPush', (test) =>
    Effect.gen(function* () {
      const storeId = `test-store-${name}-${test.task.name}-${testId}`
      const syncPayload = 'issue-1417-http-payload'

      const syncBackend = yield* makeProvider(test.task.name, undefined, syncPayload)

      yield* syncBackend.connect

      const eventFactory = makeFactory({ client: eventClient })
      yield* syncBackend.push([eventFactory.todoCreated.next({ id: 'e1', text: 'issue-1417', completed: false })])

      // Ask the backend which payload `onPush` actually observed for this store.
      const http = yield* HttpClient.HttpClient
      const baseUrl = syncBackend.metadata.url
      const baseUrlString = typeof baseUrl === 'string' ? baseUrl : objectToString(baseUrl)
      const probeUrl = new URL(baseUrlString)
      probeUrl.pathname = '/instance/push-probe'
      probeUrl.search = new URLSearchParams({ storeId }).toString()

      const response = yield* http.get(probeUrl.href).pipe(Effect.scoped)
      const probe = (yield* response.json) as { observed: boolean; payload: unknown }

      expect(probe.observed).toBe(true)
      expect(probe.payload).toBe(syncPayload)
    }).pipe(
      Effect.provide(runtimeContext),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.layer([Logger.consolePretty()]), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )
})
