// import { Effect, Layer } from '@livestore/utils/effect'
// import { PlatformNode } from '@livestore/utils/node'
// import { WranglerDevServerService } from '@livestore/utils-dev/node'

// const setupEffect = Effect.gen(function* () {
//   const server = yield* WranglerDevServerService
//   process.env.LIVESTORE_SYNC_PORT = server.port.toString()
//   return server.port
// })

// await Effect.runPromise(
//   setupEffect.pipe(
//     Effect.provide(
//       WranglerDevServerService.Default({ cwd: import.meta.dirname }).pipe(
//         Layer.provide(PlatformNode.NodeContext.layer),
//       ),
//     ),
//   ),
// )
