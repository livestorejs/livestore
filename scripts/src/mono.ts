import fs from 'node:fs'

import { liveStoreVersion } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText, OtelLiveHttp } from '@livestore/utils-dev/node'
import { buildSnippets, createSnippetsCommand } from '@local/astro-twoslash-code'
import { debugCommand } from './commands/debug.ts'
import { githubCommand } from './commands/github.ts'
import { lintCommand } from './commands/lint.ts'
import { testCommand } from './commands/test-commands.ts'
import { updateDepsCommand } from './commands/update-deps.ts'
import { copyTodomvcSrc } from './examples/copy-examples.ts'
import { command as deployExamplesCommand } from './examples/deploy-examples.ts'
import { deployToNetlify } from './shared/netlify.ts'

const cwd =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'
const docsPath = `${cwd}/docs`
const docsRebuildCommand = 'mono docs snippets build'
const docsSnippetsCommand = createSnippetsCommand({ projectRoot: docsPath, rebuildCommand: docsRebuildCommand })

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

    yield* buildSnippets({ projectRoot: docsPath, rebuildCommand: docsRebuildCommand })

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

const docsCommand = Cli.Command.make('docs').pipe(
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

const tsCommand = Cli.Command.make(
  'ts',
  {
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Clean build artifacts before compilation'),
    ),
  },
  Effect.fn(function* ({ watch, clean }) {
    if (clean) {
      yield* cmd(
        'find {examples,packages,tests,docs} -path "*node_modules*" -prune -o \\( -name "dist" -type d -a -not -path "*/wa-sqlite/dist" -o -name "*.tsbuildinfo" \\) -exec rm -rf {} +',
        { cwd, shell: true },
      )
    }

    if (watch) {
      yield* cmd('tsc --build tsconfig.dev.json --watch', { cwd })
    } else {
      yield* cmd('tsc --build tsconfig.dev.json', { cwd })
      // TODO bring back when implemented https://github.com/livestorejs/livestore/issues/477
      // yield* cmd('tsc --build tsconfig.examples.json', { cwd })
    }
  }),
)

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true })
  }),
)

const releaseSnapshotCommand = Cli.Command.make(
  'snapshot',
  {
    gitShaOption: Cli.Options.text('git-sha').pipe(Cli.Options.optional),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ gitShaOption, dryRun }) {
    const originalVersion = yield* Effect.promise(() =>
      import('../../packages/@livestore/common/package.json').then((m: any) => m.version as string),
    )

    const gitSha = gitShaOption._tag === 'Some' ? gitShaOption.value : yield* cmdText('git rev-parse HEAD')
    const filterStr = '--filter @livestore/* --filter !@livestore/effect-playwright'

    const snapshotVersion = `0.0.0-snapshot-${gitSha}`

    const versionFilePath = `${cwd}/packages/@livestore/common/src/version.ts`
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(originalVersion, snapshotVersion),
    )

    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${snapshotVersion}' --no-git-tag-version`, {
      shell: true,
    })

    yield* cmd(`pnpm ${filterStr} exec -- pnpm publish --tag=snapshot --no-git-checks ${dryRun ? '--dry-run' : ''}`, {
      shell: true,
    })

    // Rollback package.json versions
    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${originalVersion}' --no-git-tag-version`, {
      shell: true,
    })

    // Rollback version.ts
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(snapshotVersion, originalVersion),
    )
  }),
)

const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))

const examples = fs
  .readdirSync(`${cwd}/examples`)
  .filter((entry) => fs.statSync(`${cwd}/examples/${entry}`).isDirectory())

const examplesRunCommand = Cli.Command.make(
  'run',
  {
    example: Cli.Args.choice(
      examples.map((example) => [example, example]),
      { name: 'example' },
    ),
  },
  Effect.fn(function* ({ example }) {
    yield* cmd(`pnpm dev`, { cwd: `${cwd}/examples/${example}` })
  }),
)

const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([deployExamplesCommand, copyTodomvcSrc, examplesRunCommand]),
)

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([
    examplesCommand,
    lintCommand,
    githubCommand,
    testCommand,
    tsCommand,
    circularCommand,
    docsCommand,
    releaseCommand,
    updateDepsCommand,
    debugCommand,
  ]),
)

if (import.meta.main) {
  // 'CLI for managing the Livestore monorepo',
  const cli = Cli.Command.run(command, {
    name: 'mono',
    version: '0.0.0',
  })

  const layer = Layer.mergeAll(
    PlatformNode.NodeContext.layer,
    FetchHttpClient.layer,
    OtelLiveHttp({
      serviceName: 'mono',
      rootSpanName: 'cli',
      rootSpanAttributes: { 'span.label': process.argv.slice(2).join(' ') },
      skipLogUrl: process.argv.join(' ').includes('--completions'),
      traceNodeBootstrap: true,
    }),
  )

  cli(process.argv).pipe(
    Effect.provide(layer),
    Effect.annotateLogs({ thread: 'mono' }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    PlatformNode.NodeRuntime.runMain,
  )
}
