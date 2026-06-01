import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Duration,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Layer,
  Schedule,
  Schema,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.seconds(90))

// Wrangler refuses to start when proxy env vars are set (can happen in CI).
for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key]
}

const { WranglerDevServerService } = await import('@livestore/utils-dev/wrangler')

const withTestCtx = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    Layer.mergeAll(
      WranglerDevServerService.Default({
        cwd: fixturesDir,
        readiness: { connectTimeout: Duration.seconds(20) },
      }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer))),
      FetchHttpClient.layer,
    ),
})

const SyncStatus = Schema.Struct({ head: Schema.Number, eventlogMax: Schema.Number })

const makeHelpers = (serverUrl: string, storeId: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((req) =>
        req.pipe(HttpClientRequest.prependUrl(serverUrl), HttpClientRequest.setUrlParam('storeId', storeId)),
      ),
      HttpClient.filterStatusOk,
    )

    const bulk = (count: number) =>
      client.post('/store/bulk', { urlParams: { count } }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SyncStatus)))
    const boot = () => client.post('/store/boot').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SyncStatus)))
    const shutdown = () =>
      client.post('/store/shutdown').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ok: Schema.Boolean }))))
    const syncStatus = () =>
      client.get('/store/sync-status').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SyncStatus)))

    /** Poll the sync head until it reaches `target`, or give up after `timeout`. */
    const waitForHead = (target: number, timeout: Duration.DurationInput) =>
      syncStatus().pipe(
        Effect.flatMap((s) => (s.head >= target ? Effect.succeed(s) : Effect.fail('behind' as const))),
        Effect.retry(Schedule.spaced(Duration.millis(250))),
        Effect.timeout(timeout),
        Effect.either,
      )

    return { bulk, boot, shutdown, syncStatus, waitForHead }
  })

Vitest.describe('do-rpc-stream-stall', { timeout: testTimeout }, () => {
  Vitest.live('cold-boot catchup heals the sync head across a multi-chunk pull', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `stall-${nanoid(6)}`
      const { bulk, boot, shutdown, syncStatus, waitForHead } = yield* makeHelpers(server.url, storeId)

      // Enough events that the cold-boot catchup pull spans several reader.read() chunks (~150 KB).
      const total = 1000

      // 1. Commit a burst. The persisted sync head stays at 0 on the initial push (single-client CF
      //    DO doesn't echo its own pushes), so the client is already `total` events "behind" the
      //    backend — the gap the cold boot will have to catch up. Wait for the push to drain first.
      yield* bulk(total)
      yield* Effect.sleep(Duration.seconds(8))
      const beforeShutdown = yield* syncStatus()
      const target = beforeShutdown.eventlogMax
      expect(target).toBe(total) // all events committed locally and present in the eventlog

      // 2. Cold reboot. On boot the client pushes its pending events, the backend rejects them with
      //    ServerAheadError, and the missing range streams back as ONE multi-chunk catchup pull.
      yield* shutdown()
      yield* boot()

      // 3. The head must climb to the eventlog head. With the decode-per-chunk bug the catchup is
      //    silently truncated: the head freezes below `target` (and a destructive rebase can even
      //    shrink the local eventlog), so this never completes and the test fails.
      const healed = yield* waitForHead(target, Duration.seconds(45))
      const after = yield* syncStatus()
      yield* Effect.promise(() =>
        test.annotate(`after catchup: head=${after.head} eventlogMax=${after.eventlogMax} (target ${target})`),
      )
      expect(healed._tag).toBe('Right')
      expect(after.head).toBe(target)
    }).pipe(withTestCtx(test)),
  )
})
