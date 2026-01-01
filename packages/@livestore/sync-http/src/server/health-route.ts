import { Effect, HttpLayerRouter, HttpMiddleware, HttpServerResponse } from '@livestore/utils/effect'

export const HealthRoute = HttpLayerRouter.use(
  Effect.fnUntraced(function* (router) {
    yield* router.add(
      'GET',
      '/health',
      Effect.succeed(HttpServerResponse.text('OK')).pipe(HttpMiddleware.withLoggerDisabled),
    )
  }),
)
