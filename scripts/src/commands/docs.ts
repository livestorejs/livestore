import fs from 'node:fs'

import { liveStoreVersion } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'
import { buildSnippets, createSnippetsCommand } from '@local/astro-twoslash-code'

import { deployToNetlify } from '../shared/netlify.ts'

const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const docsPath = `${workspaceRoot}/docs`
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

const docsSnippetsCommand = createSnippetsCommand({ projectRoot: docsPath })

const docsBuildCommand = Cli.Command.make(
  'build',
  {
    apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Remove docs build artifacts before compilation'),
    ),
  },
  Effect.fn(function* ({ apiDocs, clean }) {
    if (clean) {
      yield* cmd('rm -rf dist .astro tsconfig.tsbuildinfo', { cwd: docsPath, shell: true })
    }

    // Always clean up .netlify folder as it can cause issues with the build
    yield* cmd('rm -rf .netlify', { cwd: docsPath })

    yield* buildSnippets({ projectRoot: docsPath })

    yield* cmd('pnpm astro build', {
      cwd: docsPath,
      env: {
        STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined,
        // Building the docs sometimes runs out of memory, so we give it more
        NODE_OPTIONS: '--max_old_space_size=4096',
      },
    })
  }),
)

export const docsCommand = Cli.Command.make('docs').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make(
      'dev',
      {
        open: Cli.Options.boolean('open').pipe(Cli.Options.withDefault(false)),
      },
      ({ open }) =>
        Effect.gen(function* () {
          yield* cmd(['pnpm', 'astro', 'dev', open ? '--open' : undefined], {
            cwd: docsPath,
            shell: true,
            logDir: `${docsPath}/logs`,
          })
        }),
    ),
    docsBuildCommand,
    docsSnippetsCommand,
    Cli.Command.make(
      'preview',
      {
        port: Cli.Options.text('port').pipe(
          Cli.Options.optional,
          Cli.Options.withDescription('Port for the preview server'),
        ),
        build: Cli.Options.boolean('build').pipe(
          Cli.Options.withDefault(false),
          Cli.Options.withDescription('Build the docs before starting the preview server'),
        ),
      },
      Effect.fn(function* ({ port: portOption, build }) {
        if (build) {
          yield* docsBuildCommand.handler({ apiDocs: false, clean: false })
        }

        const portArg = portOption._tag === 'Some' ? portOption.value : undefined

        const distPath = `${docsPath}/dist`
        if (!fs.existsSync(distPath)) {
          yield* Effect.logWarning(
            `Docs dist folder not found at ${distPath}. Run 'mono docs build' or pass '--build' to 'mono docs preview'.`,
          )
        }

        yield* cmd(
          [
            'bunx',
            'netlify-cli',
            'dev',
            '--context',
            'production',
            '--dir=dist',
            portArg !== undefined ? `--port=${portArg}` : undefined,
          ],
          {
            cwd: docsPath,
            logDir: `${docsPath}/logs`,
            env: {
              NODE_ENV: 'production',
            },
          },
        )
      }),
    ),
    Cli.Command.make(
      'deploy',
      {
        // TODO clean up when Effect CLI boolean flag is fixed
        prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false), Cli.Options.optional),
        alias: Cli.Options.text('alias').pipe(Cli.Options.optional),
        site: Cli.Options.text('site').pipe(Cli.Options.optional),
        build: Cli.Options.boolean('build').pipe(Cli.Options.withDefault(false)),
      },
      Effect.fn(
        function* ({ prod: prodOption, alias: aliasOption, site: siteOption, build: shouldBuild }) {
          if (shouldBuild) {
            yield* docsBuildCommand.handler({ apiDocs: true, clean: false })
          }

          const branchName = yield* Effect.gen(function* () {
            if (isGithubAction) {
              const branchFromEnv = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME
              if (branchFromEnv !== undefined && branchFromEnv !== '') {
                return branchFromEnv
              }
              yield* Effect.logWarning(
                'Could not determine branch name from GITHUB_HEAD_REF or GITHUB_REF_NAME in GitHub Actions. Falling back to git command.',
              )
            }
            return yield* cmdText('git rev-parse --abbrev-ref HEAD').pipe(Effect.map((name) => name.trim()))
          })

          yield* Effect.log(`Branch name: "${branchName}"`)

          const devBranchName = 'dev'

          const site =
            siteOption._tag === 'Some'
              ? siteOption.value
              : branchName === 'main'
                ? 'livestore-docs' // Prod site
                : 'livestore-docs-dev' // Dev site

          yield* Effect.log(`Deploying to "${site}" for draft URL`)

          yield* deployToNetlify({
            site,
            dir: `${docsPath}/dist`,
            target: { _tag: 'draft' },
            cwd: docsPath,
            filter: 'docs',
          })

          const alias =
            aliasOption._tag === 'Some' ? aliasOption.value : branchName.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase()

          const prod =
            prodOption._tag === 'Some' && prodOption.value === true // TODO clean up when Effect CLI boolean flag is fixed
              ? prodOption.value
              : branchName === 'main' || branchName === devBranchName

          if (prod && site === 'livestore-docs' && liveStoreVersion.includes('dev')) {
            return yield* Effect.die('Cannot deploy docs for dev version of LiveStore to prod')
          }

          yield* Effect.log(`Deploying to "${site}" ${prod ? 'in prod' : `with alias (${alias})`}`)

          yield* deployToNetlify({
            site,
            dir: `${docsPath}/dist`,
            target: prod ? { _tag: 'prod' } : { _tag: 'alias', alias },
            cwd: docsPath,
          })
        },
        Effect.catchIf(
          (e) => e._tag === 'NetlifyError' && e.reason === 'auth',
          () => Effect.logWarning('::warning Not logged in to Netlify'),
        ),
      ),
    ),
  ]),
)
