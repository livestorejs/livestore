import { expect } from 'vitest'

import { SyncBackend, UnknownError } from '@livestore/common'
import { nanoid } from '@livestore/livestore'
import { SearchParamsSchema } from '@livestore/sync-cf/common'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { objectToString } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
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
  Schema,
  Scope,
  UrlParams,
} from '@livestore/utils/effect'

import * as CloudflareHttpProvider from './providers/cloudflare-http-rpc.ts'
import { SyncProviderImpl, type SyncProviderOptions } from './types.ts'

/** Cloudflare HTTP-specific tests for response headers and HTTP transport features */

const cloudflareHttpProviders = [CloudflareHttpProvider.d1, CloudflareHttpProvider.doSqlite]

Vitest.describe.each(cloudflareHttpProviders)('$name HTTP response headers', { timeout: 30000 }, ({ layer, name }) => {
  let runtime: ManagedRuntime.ManagedRuntime<
    SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore,
    never
  >
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(KeyValueStore.layerMemory),
        Layer.provideMerge(Layer.effect(Scope.Scope)(Scope.make())),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.orDie,
      ),
    )
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = (testName?: string, options?: SyncProviderOptions) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl.asEffect(), (_) =>
        _.makeProvider(
          {
            storeId: `test-store-${name}-${testName}-${testId}`,
            clientId: 'test-client',
            payload: undefined,
          },
          options,
        ),
      ).pipe((effect) =>
        Effect.tryPromise(() =>
          runtime.runPromise(
            effect as Effect.Effect<
              SyncBackend.SyncBackend,
              UnknownError,
              SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore
            >,
          ),
        ),
      ),
    )

  Vitest.scopedLive('HTTP responses include custom headers', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)
      // Get the sync backend URL from metadata
      const metadata = syncBackend.metadata
      expect(metadata.protocol).toBe('http')
      const baseUrl = metadata.url
      const storeId = `test-store-${name}-${test.task.name}-${testId}`

      // Encode search params via the same schema the worker decodes with — `matchSyncRequest` requires
      // the full SearchParams shape. We use `null` rather than `undefined` for `payload` because
      // `UndefinedOr` drops the key during encoding, which would leave the URL missing a required field.
      const urlParamsRecord = yield* Schema.encodeEffect(SearchParamsSchema)({
        storeId,
        payload: null,
        transport: 'http',
      })

      const baseUrlString = typeof baseUrl === 'string' ? baseUrl : objectToString(baseUrl)
      const requestUrl = new URL(baseUrlString)
      requestUrl.search = UrlParams.toString(UrlParams.fromInput(urlParamsRecord))
      const req = HttpClientRequest.post(requestUrl.href).pipe(
        HttpClientRequest.setHeader('content-type', 'application/json'),
        HttpClientRequest.setHeader('x-livestore-store-id', storeId),
        HttpClientRequest.bodyJsonUnsafe({
          _tag: 'Request',
          id: 'test-req-1',
          tag: 'SyncHttpRpc.Ping',
          payload: {
            storeId,
            payload: null,
          },
        }),
      )

      const pingResponse = yield* Effect.tryPromise(() =>
        runtime.runPromise(HttpClient.execute(req).pipe(Effect.scoped)),
      )

      // Verify custom response headers are present
      expect(pingResponse.headers['x-custom-header']).toBe('test-value')
      expect(pingResponse.headers['x-livestore-version']).toBe('1.0.0')
    }).pipe(
      Vitest.makeWithTestCtx({
        makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
        forceOtel: true,
      })(test),
    ),
  )
})
