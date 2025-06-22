import { Effect, Schema } from '@livestore/utils/effect'
import { cmdText } from '@livestore/utils-dev/node'

// eslint-disable-next-line unicorn/throw-new-error
export class NetlifyError extends Schema.TaggedError<NetlifyError>()('NetlifyError', {
  reason: Schema.Literal('auth', 'unknown'),
  message: Schema.String,
}) {}

const netlifyDeployResultSchema = Schema.Struct({
  site_id: Schema.String,
  site_name: Schema.String,
  deploy_id: Schema.String,
  deploy_url: Schema.String,
  logs: Schema.String,
})

export type Target =
  | {
      _tag: 'prod'
    }
  | {
      _tag: 'alias'
      alias: string
    }
  | {
      _tag: 'draft'
    }

const NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE = 'Not logged in.'

export const deployToNetlify = ({
  site,
  dir,
  target,
  cwd,
  filter,
}: {
  site: string
  dir: string
  target: Target
  cwd: string
  filter?: string
}) =>
  Effect.gen(function* () {
    const netlifyStatus = yield* cmdText(['bunx', 'netlify-cli', 'status'], { cwd, stderr: 'pipe' })

    if (netlifyStatus.includes(NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE)) {
      return yield* new NetlifyError({ message: 'Not logged in to Netlify', reason: 'auth' })
    }

    // TODO replace pnpm dlx with bunx again once fixed (https://share.cleanshot.com/CKSg1dX9)
    const deployCommand = cmdText(
      [
        'pnpm',
        '--package=netlify-cli',
        'dlx',
        'netlify',
        // 'bunx',
        // 'netlify-cli',
        'deploy',
        '--no-build',
        '--json',
        `--dir=${dir}`,
        `--site=${site}`,
        filter ? `--filter=${filter}` : undefined,
        // Either use `--prod` or `--alias`
        target._tag === 'prod' ? '--prod' : target._tag === 'alias' ? `--alias=${target.alias}` : undefined,
      ],
      {
        cwd,
        env: { CI: '1' }, // Prevent netlify from using TTY
      },
    )

    const result = yield* deployCommand.pipe(
      Effect.tap((result) => Effect.logDebug(`[deploy-to-netlify] Deploy result for ${site}: ${result}`)),
      Effect.andThen(Schema.decode(Schema.parseJson(netlifyDeployResultSchema))),
      Effect.mapError((error) => new NetlifyError({ message: error.message, reason: 'unknown' })),
    )

    return result
  })
