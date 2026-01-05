import { nanoid } from '@livestore/livestore'
import {
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  KeyValueStore,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import * as SyncHttpProvider from './providers/sync-http.ts'
import { SyncProviderImpl, type SyncProviderOptions } from './types.ts'

/** Sync HTTP-specific tests for HTTP transport features */

Vitest.describe('Sync HTTP endpoints', { timeout: 30000 }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<SyncProviderImpl | HttpClient.HttpClient, never>
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      SyncHttpProvider.memory.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = (testName?: string, options?: SyncProviderOptions) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider(
          {
            storeId: `test-store-sync-http-${testName}-${testId}`,
            clientId: 'test-client',
            payload: undefined,
          },
          options,
        ),
      ).pipe(Effect.provide(runtime)),
    )

  Vitest.scopedLive('health endpoint is accessible', (test) =>
    Effect.gen(function* () {
      const provider = yield* Effect.provide(SyncProviderImpl, runtime)
      const providerSpecific = SyncHttpProvider.getProviderSpecific(provider)
      const http = yield* HttpClient.HttpClient

      const baseUrl = providerSpecific.getServerUrl()

      const req = HttpClientRequest.get(`${baseUrl}/health`)
      const response = yield* http.execute(req).pipe(Effect.scoped)

      expect(response.status).toBe(200)

      const body = yield* response.json
      expect(body).toEqual({ status: 'ok' })
    }).pipe(
      Effect.provide(runtime),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )

  Vitest.scopedLive('RPC ping endpoint responds correctly', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)
      const http = yield* HttpClient.HttpClient

      // Get the sync backend URL from metadata
      const metadata = syncBackend.metadata
      expect(metadata.protocol).toBe('http')
      const baseUrl = metadata.url

      // Make a raw HTTP request to the RPC ping endpoint
      const searchParams = new URLSearchParams({
        storeId: `test-store-sync-http-${test.task.name}-${testId}`,
      })

      const req = HttpClientRequest.post(`${baseUrl}/rpc?${searchParams.toString()}`).pipe(
        HttpClientRequest.setHeader('content-type', 'application/json'),
        HttpClientRequest.setHeader('x-livestore-store-id', `test-store-sync-http-${test.task.name}-${testId}`),
        HttpClientRequest.bodyUnsafeJson({
          _tag: 'Request',
          id: 'test-req-1',
          tag: 'SyncHttpRpc.Ping',
          payload: {
            storeId: `test-store-sync-http-${test.task.name}-${testId}`,
            payload: undefined,
          },
        }),
      )

      const pingResponse = yield* http.execute(req).pipe(Effect.scoped)

      expect(pingResponse.status).toBe(200)

      // Verify we get a valid response
      const body = yield* pingResponse.json
      expect(body).toBeDefined()
    }).pipe(
      Effect.provide(runtime),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )

  Vitest.scopedLive('metadata indicates correct protocol', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      // Verify metadata is correctly set
      const metadata = syncBackend.metadata
      expect(metadata.name).toBe('@livestore/sync-http')
      expect(metadata.protocol).toBe('http')
      expect(metadata.description).toBe('LiveStore sync backend using HTTP transport')
      expect(metadata.url).toContain('http://')
    }).pipe(
      Effect.provide(runtime),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )
})

Vitest.describe('Sync HTTP SSE live pull', { timeout: 30000 }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<SyncProviderImpl | HttpClient.HttpClient, never>
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      SyncHttpProvider.memorySse.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  Vitest.scopedLive('SSE endpoint is accessible', (test) =>
    Effect.gen(function* () {
      const provider = yield* Effect.provide(SyncProviderImpl, runtime)
      const providerSpecific = SyncHttpProvider.getProviderSpecific(provider)
      const http = yield* HttpClient.HttpClient

      const baseUrl = providerSpecific.getServerUrl()

      // SSE endpoint uses path parameter for storeId: /sse/:storeId
      const storeId = `test-store-sync-http-sse-${test.task.name}-${testId}`

      const req = HttpClientRequest.get(`${baseUrl}/sse/${storeId}`).pipe(
        HttpClientRequest.setHeader('accept', 'text/event-stream'),
      )

      // Just check we can initiate the SSE connection (we'll abort quickly)
      const response = yield* http.execute(req).pipe(Effect.scoped)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/event-stream')
    }).pipe(
      Effect.provide(runtime),
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )
})
