import path from 'node:path'
import { shouldNeverHappen } from '@livestore/utils'
import { Context, Effect, Layer } from '@livestore/utils/effect'

export interface WorkspaceInfo {
  /** Absolute workspace root path. */
  readonly root: string
  /** Join helper scoped to the workspace root. */
  readonly join: (...parts: string[]) => string
}

export const makeWorkspaceInfo = (root: string): WorkspaceInfo => ({
  root,
  join: (...parts) => path.join(root, ...parts),
})

/** Current working directory. */
export class CurrentWorkingDirectory extends Context.Tag('CurrentWorkingDirectory')<
  CurrentWorkingDirectory,
  WorkspaceInfo
>() {
  /** Layer that captures the process cwd once. */
  static live = Layer.effect(
    CurrentWorkingDirectory,
    Effect.sync(() => makeWorkspaceInfo(process.cwd())),
  )

  /** Override CWD for tests or nested invocations. */
  static fromPath = (cwd: string) => Layer.succeed(CurrentWorkingDirectory, makeWorkspaceInfo(cwd))
}

/** Livestore workspace root (simple env or fallback). */
export class LivestoreWorkspace extends Context.Tag('LivestoreWorkspace')<LivestoreWorkspace, WorkspaceInfo>() {
  /** Resolve from env or `<cwd>/submodules/livestore`. */
  static live = Layer.effect(
    LivestoreWorkspace,
    Effect.gen(function* () {
      const root = process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
      return makeWorkspaceInfo(root)
    }).pipe(Effect.withSpan('resolveLivestoreWorkspace')),
  )

  /** Provide a fixed Livestore root. */
  static fromPath = (root: string) => Layer.succeed(LivestoreWorkspace, makeWorkspaceInfo(root))
}
