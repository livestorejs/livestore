import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
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
  type Schema,
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

describeHttpProviders('$name HTTP response headers', { timeout: 30000 }, ({ layer, name }) => {
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

  // Skipped: the hand-rolled RPC envelope below no longer completes, so the server's 10s
  // timeout fires before `responseHeaders` is applied and the assertion sees `undefined`.
  // The header feature itself works; the test's coupling to the wire format is the problem.
  // https://github.com/livestorejs/livestore/issues/1490
  Vitest.live.skip('HTTP responses include custom headers', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)
      const http = yield* HttpClient.HttpClient

      // Get the sync backend URL from metadata
      const metadata = syncBackend.metadata
      expect(metadata.protocol).toBe('http')
      const baseUrl = metadata.url

      // Make a raw HTTP request to the ping endpoint
      const searchParams = new URLSearchParams({
        storeId: `test-store-${name}-${test.task.name}-${testId}`,
        transport: 'http',
      })

      const baseUrlString = typeof baseUrl === 'string' ? baseUrl : objectToString(baseUrl)
      const requestUrl = new URL(baseUrlString)
      requestUrl.search = searchParams.toString()
      const req = HttpClientRequest.post(requestUrl.href).pipe(
        HttpClientRequest.setHeader('content-type', 'application/json'),
        HttpClientRequest.setHeader('x-livestore-store-id', `test-store-${name}-${test.task.name}-${testId}`),
        HttpClientRequest.bodyJsonUnsafe({
          _tag: 'Request',
          id: 'test-req-1',
          tag: 'SyncHttpRpc.Ping',
          payload: {
            storeId: `test-store-${name}-${test.task.name}-${testId}`,
            payload: undefined,
          },
        }),
      )

      const pingResponse = yield* http.execute(req).pipe(Effect.scoped)

      // Verify custom response headers are present
      expect(pingResponse.headers['x-custom-header']).toBe('test-value')
      expect(pingResponse.headers['x-livestore-version']).toBe('1.0.0')
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
