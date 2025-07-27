import path from 'node:path'
import { Effect } from '@livestore/utils/effect'
import { cmd } from '@livestore/utils-dev/node'

/**
 * Given the LiveStore monorepo is sometimes embedded in another git repo as a submodule,
 * we sometime want to check for this situation.
 */
export const hasParentGitRepo = Effect.gen(function* () {
  const workspaceParentDir = path.resolve(process.env.WORKSPACE_ROOT!, '..')
  return yield* cmd(['git', '-C', workspaceParentDir, 'rev-parse', '--is-inside-work-tree'], {
    cwd: workspaceParentDir,
    stdout: 'pipe', // ignore output
    stderr: 'pipe', // ignore error
  }).pipe(Effect.isSuccess)
})
