import http from 'node:http'
import { UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/livestore'
import * as S2Sync from '@livestore/sync-s2'
import { makeSyncBackend } from '@livestore/sync-s2'
import * as S2Helpers from '@livestore/sync-s2/s2-proxy-helpers'
import {
  Config,
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
  Schedule,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'
// HTTP-based proxy to hosted S2

export const name = 'S2 (hosted)'

export const prepare = Effect.void

export type ProviderSpecific = {
  appendRaw: (storeId: string, bodies: string[]) => Effect.Effect<void>
  failNextAppend: (storeId: string, count: number) => Effect.Effect<void>
  failNextRead: (storeId: string, count: number) => Effect.Effect<void>
}

export const layer: SyncProviderLayer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { endpointPort, basin, accountClient } = yield* startApiProxy
    const keepBasins = process.env.LIVESTORE_S2_KEEP_BASINS === '1'
    yield* Effect.addFinalizer(() =>
      keepBasins
        ? Effect.void
        : accountClient
            .deleteBasin(basin)
            .pipe(
              Effect.retry(Schedule.exponentialBackoff10Sec),
              Effect.withSpan('s2-provider:delete-basin', { attributes: { basin } }),
              Effect.ignoreLogged,
            ),
    )

    return {
      makeProvider: makeSyncBackend({ endpoint: `http://localhost:${endpointPort}` }),
      turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
      turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
      providerSpecific: {
        appendRaw: (storeId: string, bodies: string[]) =>
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const req = HttpClientRequest.post(`http://localhost:${endpointPort}/_test/append-raw`).pipe(
              HttpClientRequest.setHeader('content-type', 'application/json'),
              HttpClientRequest.bodyUnsafeJson({ storeId, bodies }),
            )
            yield* http
              .pipe(HttpClient.filterStatusOk)
              .execute(req)
              .pipe(
                Effect.andThen((res) => res.text),
                Effect.ignore,
                Effect.retry(Schedule.exponentialBackoff10Sec),
                Effect.withSpan('s2-provider:append-raw-request', {
                  attributes: { storeId, recordCount: bodies.length },
                }),
              )
          }),
        failNextAppend: (storeId: string, count: number) =>
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const req = HttpClientRequest.post(`http://localhost:${endpointPort}/_test/fail-next-append`).pipe(
              HttpClientRequest.setHeader('content-type', 'application/json'),
              HttpClientRequest.bodyUnsafeJson({ storeId, count }),
            )
            yield* http
              .pipe(HttpClient.filterStatusOk)
              .execute(req)
              .pipe(
                Effect.andThen((res) => res.text),
                Effect.ignore,
                Effect.retry(Schedule.exponentialBackoff10Sec),
                Effect.withSpan('s2-provider:fail-next-append-request', { attributes: { storeId, count } }),
              )
          }),
        failNextRead: (storeId: string, count: number) =>
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const req = HttpClientRequest.post(`http://localhost:${endpointPort}/_test/fail-next-read`).pipe(
              HttpClientRequest.setHeader('content-type', 'application/json'),
              HttpClientRequest.bodyUnsafeJson({ storeId, count }),
            )
            yield* http
              .pipe(HttpClient.filterStatusOk)
              .execute(req)
              .pipe(
                Effect.andThen((res) => res.text),
                Effect.ignore,
                Effect.retry(Schedule.exponentialBackoff10Sec),
                Effect.withSpan('s2-provider:fail-next-read-request', { attributes: { storeId, count } }),
              )
          }),
      },
    }
  }),
).pipe(UnexpectedError.mapToUnexpectedErrorLayer)

const startApiProxy = Effect.gen(function* () {
  const endpointPort = yield* getFreePort
  const basin = `ls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const token = yield* Config.string('S2_ACCESS_TOKEN')

  const s2Config: S2Helpers.S2Config = {
    basin,
    token,
  }

  // Prefer HTTP API for provisioning if available
  const httpClient = yield* HttpClient.HttpClient.pipe(
    Effect.andThen(HttpClient.mapRequest(HttpClientRequest.setHeaders({ Authorization: `Bearer ${token}` }))),
  )

  const accountClient = S2Sync.HttpClientGenerated.make(httpClient, {
    transformClient: (client) =>
      Effect.succeed(
        client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(S2Helpers.getAccountUrl(s2Config, '')))),
      ),
  })

  const basinClient = S2Sync.HttpClientGenerated.make(httpClient, {
    transformClient: (client) =>
      Effect.succeed(
        client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(S2Helpers.getBasinUrl(s2Config, '')))),
      ),
  })

  yield* accountClient
    .createBasin({ basin })
    .pipe(
      Effect.retry(Schedule.exponentialBackoff10Sec),
      Effect.withSpan('s2-provider:create-basin', { attributes: { basin } }),
    )

  yield* makeRouter({ s2Config, basinClient }).pipe(
    HttpServer.serve(),
    Layer.provide(PlatformNode.NodeHttpServer.layer(() => http.createServer(), { port: endpointPort })),
    Layer.launch,
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )

  return { endpointPort, basin, accountClient }
})

const createdStreams = new Set<string>()
const closedOnceStreams = new Set<string>()
const failNextAppend = new Map<string, number>()
const failNextRead = new Map<string, number>()

const makeRouter = ({
  s2Config,
  basinClient,
}: {
  s2Config: S2Helpers.S2Config
  basinClient: S2Sync.HttpClientGenerated.Client
}) => {
  return HttpRouter.empty.pipe(
    // GET / (pull)
    HttpRouter.get(
      '/',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const args = S2Sync.decodePullArgsFromSearchParams(new URL(request.url, 'http://localhost').searchParams)

        const stream = S2Sync.makeS2StreamName(args.storeId)
        if (!createdStreams.has(stream)) {
          yield* basinClient
            .createStream({ stream })
            .pipe(
              Effect.retry(Schedule.exponentialBackoff10Sec),
              Effect.withSpan('s2-provider:create-stream', { attributes: { stream, route: 'pull' } }),
            )
          createdStreams.add(stream)
        }

        if ((args.payload as any)?.testCloseOnce === true && !closedOnceStreams.has(stream)) {
          closedOnceStreams.add(stream)
          const sseLines = ['event: ping', 'data: {}', '']
          return yield* HttpServerResponse.stream(Stream.fromIterable(sseLines).pipe(Stream.encodeText), {
            contentType: 'text/event-stream',
          })
        }
        // SSE tailing: proxy S2 SSE stream directly
        const pullRequest = S2Helpers.buildPullRequest({ config: s2Config, args })
        // console.log('[s2] pull request:', S2Helpers.asCurl({ ...pullRequest, method: 'GET' }))
        const resp = yield* HttpClientRequest.get(pullRequest.url).pipe(
          HttpClientRequest.setHeaders(pullRequest.headers),
          HttpClient.execute,
          Effect.retry(Schedule.exponentialBackoff10Sec),
          Effect.withSpan('s2-provider:pull-stream', { attributes: { stream, live: args.live } }),
        )

        const bodyStream = HttpClientResponse.stream(Effect.succeed(resp))
        return yield* HttpServerResponse.stream(bodyStream, { contentType: 'text/event-stream' })
      }).pipe(
        // Never fail the route: return empty ReadBatch on unexpected error to keep the pull stream alive
        Effect.catchAll(() => HttpServerResponse.json({ records: [] })),
      ),
    ),

    // POST / (push)
    HttpRouter.post(
      '/',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = yield* request.json
        const parsed = yield* Schema.decodeUnknown(S2Sync.ApiSchema.PushPayload)(body)

        const streamName = S2Sync.makeS2StreamName(parsed.storeId)
        if (!createdStreams.has(streamName)) {
          yield* basinClient.createStream({ stream: streamName }).pipe(
            Effect.catchIf(
              (_) => _._tag === 'ErrorResponse' && _.cause.code === 'stream_already_exists',
              () => Effect.void,
            ),
            Effect.retry(Schedule.exponentialBackoff10Sec),
            Effect.withSpan('s2-provider:create-stream', {
              attributes: { stream: streamName, route: 'push' },
            }),
          )
          createdStreams.add(streamName)
        }
        const lines = parsed.batch.map((ev: LiveStoreEvent.AnyEncodedGlobal) => JSON.stringify(ev))
        if ((failNextAppend.get(streamName) ?? 0) > 0) {
          failNextAppend.set(streamName, (failNextAppend.get(streamName) ?? 1) - 1)
          return yield* HttpServerResponse.json({ error: 'test induced append failure' }, { status: 500 })
        }
        yield* basinClient
          .append(streamName, {
            params: { 's2-format': 'raw' },
            payload: { records: lines.map((line: string) => ({ body: line })) },
          })
          .pipe(
            Effect.retry(Schedule.exponentialBackoff10Sec),
            Effect.withSpan('s2-provider:append', { attributes: { stream: streamName, recordCount: lines.length } }),
          )

        return yield* HttpServerResponse.json({ success: true })
      }),
    ),

    // POST /_test/append-raw (test-only)
    HttpRouter.post(
      '/_test/append-raw',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = (yield* request.json) as { storeId: string; bodies: string[] }
        const stream = S2Sync.makeS2StreamName(body.storeId)
        if (!createdStreams.has(stream)) {
          yield* basinClient.createStream({ stream }).pipe(
            Effect.catchIf(
              (_) => _._tag === 'ErrorResponse' && _.cause.code === 'stream_already_exists',
              () => Effect.void,
            ),
            Effect.retry(Schedule.exponentialBackoff10Sec),
            Effect.withSpan('s2-provider:create-stream', {
              attributes: { stream, route: 'append-raw' },
            }),
          )
          createdStreams.add(stream)
        }
        yield* basinClient
          .append(stream, {
            params: { 's2-format': 'raw' },
            payload: { records: body.bodies.map((line) => ({ body: line })) },
          })
          .pipe(
            Effect.retry(Schedule.exponentialBackoff10Sec),
            Effect.withSpan('s2-provider:append', {
              attributes: { stream, recordCount: body.bodies.length, route: 'append-raw' },
            }),
          )
        return yield* HttpServerResponse.json({ success: true })
      }),
    ),

    // POST /_test/fail-next-append
    HttpRouter.post(
      '/_test/fail-next-append',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = (yield* request.json) as { storeId: string; count: number }
        failNextAppend.set(S2Sync.makeS2StreamName(body.storeId), Math.max(0, Math.floor(body.count ?? 1)))
        return yield* HttpServerResponse.json({ success: true })
      }),
    ),

    // POST /_test/fail-next-read
    HttpRouter.post(
      '/_test/fail-next-read',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = (yield* request.json) as { storeId: string; count: number }
        failNextRead.set(S2Sync.makeS2StreamName(body.storeId), Math.max(0, Math.floor(body.count ?? 1)))
        return yield* HttpServerResponse.json({ success: true })
      }),
    ),

    // HEAD / (ping)
    HttpRouter.head('/', HttpServerResponse.empty()),
  )
}
