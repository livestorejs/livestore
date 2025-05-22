import { $ } from 'bun'
import { Effect } from 'effect'

export * as PlatformBun from '@effect/platform-bun'

// TODO remove in favour of other `cmd` implementation
export const cmd = (_: string) =>
  Effect.promise(() => {
    console.log(`Running command: ${_}`)
    return $`${{ raw: _ }}`
  })

export { $ } from 'bun'
