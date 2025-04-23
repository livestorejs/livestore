import { makeWorker } from "@livestore/adapter-web/worker";
// import type { MakeBackendArgs, SyncBackend } from "@livestore/common";
// import { Effect, type Scope } from "effect";
import { schema } from "./lib/schema";

// export interface CustomSyncOptions {
//   id: string;
// }

// export const makeCustomSync =
//   (options: CustomSyncOptions) =>
//   (
//     args: MakeBackendArgs
//   ): Effect.Effect<SyncBackend<null>, never, Scope.Scope> =>
//     Effect.gen(function* () {
//       return {
//         connect: Effect.gen(function* () {}),
//         isConnected: Effect.gen(function* () {}),
//         metadata: Effect.gen(function* () {}),
//         pull: () => Effect.gen(function* () {}),
//         push: () => Effect.gen(function* () {}),
//       } satisfies SyncBackend<null>;
//     });

makeWorker({
  schema,
  // TODO: Guide on how to implement a custom sync worker
  //   sync: {
  //     backend: makeCustomSync({ id: "123" }),
  //   },
});
