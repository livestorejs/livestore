import {
  Effect,
  HttpLayerRouter,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
  Schema,
  Socket,
} from '@livestore/utils/effect'
import { syncSocket } from './socket-sync.ts'
import { StoreLookup } from './store-lookup.ts'

export const SyncRoute = HttpLayerRouter.use(
  Effect.fnUntraced(function* (router) {
    const lookup = yield* StoreLookup

    yield* router.add(
      'GET',
      '/_sync',
      Effect.gen(function* () {
        const { storeId } = yield* parseUrlParams
        const socket = yield* HttpServerRequest.upgrade
        yield* syncSocket(storeId).pipe(
          Effect.provideService(StoreLookup, lookup),
          Effect.provideService(Socket.Socket, socket),
        )
        return HttpServerResponse.empty()
      }),
    )
  }),
).pipe(Layer.provide(StoreLookup.Default))

const UrlParamsSchema = Schema.Struct({
  storeId: Schema.NonEmptyString,
})
const parseUrlParams = HttpServerRequest.schemaSearchParams(UrlParamsSchema)
