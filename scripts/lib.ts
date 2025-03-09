import { Effect } from '@livestore/utils/effect'
import { $ } from 'bun'
export { Cli } from '@livestore/utils/node'

const cmd = (command: string, cwd?: string) =>
  Effect.promise(() => (cwd ? $`${{ raw: command }}`.cwd(cwd) : $`${{ raw: command }}`))

const cmdJson = (command: string, cwd?: string) =>
  Effect.promise(() => (cwd ? $`${{ raw: command }} --json`.cwd(cwd).json() : $`${{ raw: command }} --json`.json()))

const cmdText = (command: string, cwd?: string) =>
  Effect.promise(() => (cwd ? $`${{ raw: command }}`.cwd(cwd).text() : $`${{ raw: command }}`.text()))

const cmdTextNothrow = (command: string, cwd?: string) =>
  Effect.promise(() =>
    cwd ? $`${{ raw: command }}`.cwd(cwd).nothrow().text() : $`${{ raw: command }}`.nothrow().text(),
  )

export const BunShell = {
  cmd,
  cmdJson,
  cmdText,
  cmdTextNothrow,
}
