import { expect } from 'vite-plus/test'

import { nanoid } from '@livestore/livestore'
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
} from '@livestore/utils/effect'

import * as CloudflareHttpProvider from './providers/cloudflare-http-rpc.ts'
import { SyncProviderImpl, type SyncProviderOptions } from './types.ts'

/** Cloudflare HTTP-specific tests for response headers and HTTP transport features */

const cloudflareHttpProviders = [CloudflareHttpProvider.d1, CloudflareHttpProvider.doSqlite]

type RuntimeServices = SyncProviderImpl | HttpClient.HttpClient

Vitest.describe.each(cloudflareHttpProviders)('$name HTTP response headers', { timeout: 30000 }, ({ layer, name }) => {
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

  const makeProvider = (testName?: string, options?: SyncProviderOptions) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider(
          {
            storeId: `test-store-${name}-${testName}-${testId}`,
            clientId: 'test-client',
            payload: undefined,
          },
          options,
        ),
      ).pipe(Effect.provide(runtimeContext)),
    )

  Vitest.live('HTTP responses include custom headers', (test) =>
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
})
