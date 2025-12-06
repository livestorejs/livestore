import path from 'node:path'
import { shouldNeverHappen } from '@livestore/utils'
import { Context, Effect, Layer } from '@livestore/utils/effect'

export type WorkspaceInfo = string

/** Current working directory. */
export class CurrentWorkingDirectory extends Context.Tag('CurrentWorkingDirectory')<
  CurrentWorkingDirectory,
  WorkspaceInfo
>() {
  /** Layer that captures the process cwd once. */
  static live = Layer.effect(
    CurrentWorkingDirectory,
    Effect.sync(() => process.cwd()),
  )

  /** Override CWD for tests or nested invocations. */
  static fromPath = (cwd: string) => Layer.succeed(CurrentWorkingDirectory, cwd)
}

/** Livestore workspace root (env required). */
export class LivestoreWorkspace extends Context.Tag('LivestoreWorkspace')<LivestoreWorkspace, WorkspaceInfo>() {
  /** Resolve from WORKSPACE_ROOT env. */
  static live = Layer.effect(
    LivestoreWorkspace,
    Effect.sync(() => {
      const root = process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
      return root
    }),
  )

  /** Provide a fixed Livestore root. */
  static fromPath = (root: string) => Layer.succeed(LivestoreWorkspace, root)

  /** Derive a CurrentWorkingDirectory layer from the Livestore workspace root (with optional subpath) */
  static toCwd = (/** Relative path to the Livestore workspace root */ subPath?: string) =>
    Layer.effect(
      CurrentWorkingDirectory,
      Effect.gen(function* () {
        const root = yield* LivestoreWorkspace
        return path.join(root, subPath ?? '')
      }),
    )
}
