import type { InvalidPullError, InvalidPushError, SyncBackend } from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import {
  Context,
  Effect,
  FiberSet,
  Mailbox,
  Option,
  RcMap,
  RcRef,
  ReadonlyArray,
  Schedule,
  type Scope,
  Socket,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { decodePullEventSync, encodePushEventSync, type PushEventFromJson } from '../shared.ts'

export class ConnectionManager extends Context.Tag('@livestore/sync-http/client/ConnectionManager')<
  ConnectionManager,
  {
    readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>

    readonly connect: Effect.Effect<void, never, Scope.Scope>

    readonly ping: Effect.Effect<void, never>

    readonly pull: (options: {
      readonly cursor: EventSequenceNumber.Global.Type
      readonly live: boolean
    }) => Effect.Effect<Mailbox.Mailbox<SyncBackend.PullResItem, InvalidPullError>, never, Scope.Scope>

    readonly push: (events: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<void, InvalidPushError>
  }
>() {
  static readonly make = Effect.fnUntraced(function* (options: { readonly baseUrl: string; readonly storeId: string }) {
    const isConnected = yield* SubscriptionRef.make(false)
    const pullMailboxes = yield* RcMap.make({
      lookup: (_id: number) => Mailbox.make<SyncBackend.PullResItem, InvalidPullError>(),
    })
    const pushResumes = new Map<number, (effect: Effect.Effect<void, InvalidPushError>) => void>()
    const pongResumes = new Map<number, (effect: Effect.Effect<void>) => void>()
    const runFork = yield* FiberSet.makeRuntime()

    const connection = yield* RcRef.make({
      acquire: Effect.gen(function* () {
        const urlParams = new URLSearchParams({ storeId: options.storeId })
        const socket = yield* Socket.makeWebSocket(`${options.baseUrl}/_sync?${urlParams.toString()}`)
        const write = yield* socket.writer

        yield* Effect.addFinalizer(() => SubscriptionRef.set(isConnected, false))
        const decoder = new TextDecoder()
        yield* socket
          .runRaw(
            (msg) => {
              const text = typeof msg === 'string' ? msg : decoder.decode(msg)
              const pullEvent = decodePullEventSync(text)

              switch (pullEvent._tag) {
                case 'Pull': {
                  return RcMap.get(pullMailboxes, pullEvent.id).pipe(
                    Effect.flatMap((mailbox) =>
                      mailbox.offer({
                        batch: pullEvent.batch.map((eventEncoded) => ({
                          eventEncoded,
                          metadata: Option.none(),
                        })),
                        pageInfo: { _tag: 'NoMore' },
                      }),
                    ),
                    Effect.scoped,
                  )
                }
                case 'PullError': {
                  return RcMap.get(pullMailboxes, pullEvent.id).pipe(
                    Effect.flatMap((mailbox) => mailbox.failCause(pullEvent.cause)),
                    Effect.scoped,
                  )
                }
                case 'PushResponse': {
                  const resume = pushResumes.get(pullEvent.id)
                  if (!resume) return
                  return resume(pullEvent.exit)
                }
                case 'Pong': {
                  const resume = pongResumes.get(pullEvent.id)
                  if (!resume) return
                  return resume(Effect.void)
                }
              }
            },
            {
              onOpen: SubscriptionRef.set(isConnected, true),
            },
          )
          .pipe(
            Effect.catchAllCause(Effect.logDebug),
            Effect.repeat(Schedule.exponentialBackoff10Sec),
            Effect.annotateLogs({
              fiber: '@livestore/sync-http/client/ConnectionManager/socket',
            }),
            Effect.forkScoped,
          )

        return { write } as const
      }),
    })

    const writePushEvent = (event: typeof PushEventFromJson.Type) =>
      RcRef.get(connection).pipe(
        Effect.flatMap(({ write }) => write(encodePushEventSync(event))),
        Effect.scoped,
      )

    let pingId = 0
    const ping = Effect.async<void>((resume) => {
      const id = pingId++
      pongResumes.set(id, resume)
      runFork(writePushEvent({ _tag: 'Ping', id }))
      return Effect.sync(() => {
        pongResumes.delete(id)
      })
    })

    let pullId = 0
    const pull = Effect.fnUntraced(function* (options: {
      readonly cursor: EventSequenceNumber.Global.Type
      readonly live: boolean
    }) {
      const id = pullId++
      const mailbox = yield* RcMap.get(pullMailboxes, id)
      yield* Effect.orDie(
        writePushEvent({
          _tag: 'PullRequest',
          id,
          cursor: options.cursor,
          live: options.live,
        }),
      )
      yield* Effect.addFinalizer(() =>
        Effect.orDie(
          writePushEvent({
            _tag: 'PullCancel',
            id,
          }),
        ),
      )
      return mailbox
    })

    let pushId = 0
    const push = (events: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => {
      if (!ReadonlyArray.isNonEmptyReadonlyArray(events)) {
        return Effect.void
      }
      return Effect.async<void, InvalidPushError>((resume) => {
        const id = pushId++
        pushResumes.set(id, resume)
        runFork(
          writePushEvent({
            _tag: 'Push',
            id,
            batch: events,
          }),
        )
        return Effect.sync(() => {
          pushResumes.delete(id)
        })
      })
    }

    const connect = Effect.asVoid(RcRef.get(connection))

    return ConnectionManager.of({
      connect,
      isConnected,
      pull,
      ping,
      push,
    })
  })
}
