import fs from 'node:fs'
import { liveStoreVersion } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, HttpClient, HttpClientRequest, Schedule } from '@livestore/utils/effect'
import { Cli, getFreePort } from '@livestore/utils/node'
import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { buildDiagrams, watchDiagrams } from '@local/astro-tldraw'
import { buildSnippets, createSnippetsCommand } from '@local/astro-twoslash-code'
import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'
import { deployToNetlify, purgeNetlifyCdn } from '../shared/netlify.ts'
import { exportMarkdownCommand } from './docs-export.ts'

const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const docsPath = `${workspaceRoot}/docs`
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

const docsSnippetsCommand = createSnippetsCommand({ projectRoot: docsPath })

const runDocsDiagramsBuild = buildDiagrams({ projectRoot: docsPath, verbose: true }).pipe(
  Effect.tapError((error) =>
    error._tag === 'Tldraw.RenderTimeoutError'
      ? Effect.logWarning('Docs diagram render timed out — retrying with exponential backoff up to 10s...')
      : Effect.void,
  ),
  Effect.retry({
    schedule: Schedule.exponentialBackoff10Sec,
    while: (error) => error._tag === 'Tldraw.RenderTimeoutError',
  }),
)

const runDocsDiagramsWatch = watchDiagrams({ projectRoot: docsPath, verbose: true })

const runDocsDiagramsWatchNoInitialBuild = watchDiagrams({
  projectRoot: docsPath,
  verbose: true,
  initialBuild: false,
})

const docsDiagramsCommand = Cli.Command.make('diagrams', {}, () => runDocsDiagramsBuild).pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('build', {}, () => runDocsDiagramsBuild),
    Cli.Command.make('watch', {}, () => runDocsDiagramsWatch),
  ]),
)

type NetlifyDeploySummary = {
  site_id: string
  site_name: string
  deploy_id: string
  deploy_url: string
  logs: string
}

const formatDocsDeploymentSummaryMarkdown = ({
  site,
  alias,
  prod,
  purgeCdn,
  draftDeploy,
  finalDeploy,
}: {
  site: string
  alias: string
  prod: boolean
  purgeCdn: boolean
  draftDeploy: NetlifyDeploySummary
  finalDeploy: NetlifyDeploySummary
}) => {
  const rows: Array<ReadonlyArray<string>> = []

  rows.push(['draft', site, draftDeploy.deploy_id, draftDeploy.deploy_url, 'draft URL'])

  const notes: string[] = []
  if (!prod) {
    notes.push(`alias: ${alias}`)
  }
  if (purgeCdn) {
    notes.push('CDN purged')
  }

  rows.push([
    prod ? 'prod' : 'alias',
    site,
    finalDeploy.deploy_id,
    finalDeploy.deploy_url,
    notes.length > 0 ? notes.join(', ') : '—',
  ])

  return formatMarkdownTable({
    title: 'Docs deployment',
    headers: ['Stage', 'Site', 'Deploy ID', 'URL', 'Notes'],
    rows,
    emptyMessage: '_Docs deployment did not run._',
  })
}

/**
 * Tldraw diagram rendering (via @kitschpatrol/tldraw-cli/Puppeteer) can leave a Chromium
 * child alive after work completes, keeping `mono docs build` hanging in CI
 * (e.g. https://github.com/livestorejs/livestore/actions/runs/19968500091/job/57266669492).
 * This helper force-kills Chromium children of the current mono process in the docs CWD.
 */
const cleanupChromiumChildren = Effect.fn('cleanup-chromium-children')(function* () {
  const parentPid = String(process.pid)
  const script =
    'pids=$(ps -eo pid=,ppid=,comm= | awk -v ppid="' +
    parentPid +
    "\" '/chromium|chrome_crashpad_handler/ { if ($2==ppid) print $1 }'); " +
    'if [ -z "$pids" ]; then exit 0; fi; echo "Cleaning up stale Chromium processes: $pids"; kill $pids 2>/dev/null || true'

  yield* cmd(script, { shell: true, stdout: 'inherit', stderr: 'inherit' }).pipe(
    Effect.provide(LivestoreWorkspace.toCwd('docs')),
    Effect.ignoreLogged,
  )
})

const docsBuildCommand = Cli.Command.make(
  'build',
  {
    apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Remove docs build artifacts and cached snippet/tldraw renders before compilation'),
    ),
    skipDeps: Cli.Options.boolean('skip-deps').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Skip building snippets and diagrams'),
    ),
  },
  Effect.fn(function* ({ apiDocs, clean, skipDeps }) {
    if (clean) {
      // Wipe Astro output plus cached diagram/snippet artefacts to avoid stale renders between builds.
      yield* cmd(
        'rm -rf dist .astro tsconfig.tsbuildinfo node_modules/.astro-tldraw node_modules/.astro-twoslash-code .cache/snippets',
        { shell: true },
      ).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))
    }

    // Always clean up .netlify folder as it can cause issues with the build
    yield* cmd('rm -rf .netlify').pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))

    if (!skipDeps) {
      yield* Effect.log('Building snippets and diagrams...')
      yield* Effect.all([buildSnippets({ projectRoot: docsPath }), runDocsDiagramsBuild], {
        concurrency: 'unbounded',
      })
      yield* Effect.log('Snippets and diagrams built successfully')
      yield* cleanupChromiumChildren()
    }

    // Local/CI prebuild uses Astro directly. The deploy step performs the
    // Netlify build (single build overall), which handles Edge bundling.
    yield* cmd('pnpm astro build', {
      env: {
        STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined,
        // Building the docs sometimes runs out of memory, so we give it more
        NODE_OPTIONS: '--max_old_space_size=4096',
        // Snippets/diagrams already built above (or skipped), tell Astro integrations not to auto-build.
        // Without these flags, the integrations would rebuild during astro:build:start, duplicating work.
        LS_SKIP_SNIPPET_AUTO_BUILD_AND_WATCH: '1',
        LS_TLDRAW_SKIP_AUTO_BUILD: '1',
        LS_SKIP_OG_IMAGES: process.env.LS_SKIP_OG_IMAGES ?? '1',
      },
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))
    yield* cleanupChromiumChildren()
  }),
)

export const docsCommand = Cli.Command.make('docs').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make(
      'dev',
      {
        open: Cli.Options.boolean('open').pipe(Cli.Options.withDefault(false)),
        skipDeps: Cli.Options.boolean('skip-deps').pipe(
          Cli.Options.withDefault(false),
          Cli.Options.withDescription('Skip building snippets and diagrams'),
        ),
      },
      Effect.fn(function* ({ open, skipDeps }) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            if (!skipDeps) {
              yield* Effect.log('Building snippets and diagrams...')
              yield* Effect.all([buildSnippets({ projectRoot: docsPath }), runDocsDiagramsBuild], {
                concurrency: 'unbounded',
              })
              yield* Effect.log('Snippets and diagrams built successfully')
            }

            /* Run Astro dev server (and optionally diagrams watch) */
            const astroDevEffect = cmd(['pnpm', 'astro', 'dev', open ? '--open' : undefined], {
              logDir: `${docsPath}/logs`,
            }).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))

            if (!skipDeps) {
              yield* runDocsDiagramsWatchNoInitialBuild.pipe(
                Effect.catchAllCause((cause) => Effect.logWarning(`Diagrams watch stopped: ${cause}`)),
                Effect.forkScoped,
              )
            }

            yield* astroDevEffect
          }),
        )
      }),
    ),
    docsBuildCommand,
    docsSnippetsCommand,
    docsDiagramsCommand,
    exportMarkdownCommand,
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
          yield* docsBuildCommand.handler({ apiDocs: false, clean: false, skipDeps: false })
        }

        const requestedPort = portOption._tag === 'Some' ? Number.parseInt(portOption.value, 10) : undefined
        const previewTargetPort = yield* getFreePort

        const distPath = `${docsPath}/dist`
        if (!fs.existsSync(distPath)) {
          yield* Effect.logWarning(
            `Docs dist folder not found at ${distPath}. Run 'mono docs build' or pass '--build' to 'mono docs preview'.`,
          )
        }

        const previewScript = `${docsPath}/scripts/preview-server.ts`
        // Netlify Dev requires a target application server; we launch the Bun
        // preview server so the edge runtime can proxy to `dist/` just like it
        // does in production.
        const netlifyArgs: string[] = [
          'netlify-cli',
          'dev',
          '--context',
          'production',
          '--command',
          `bun ${previewScript} --host=127.0.0.1 --port ${previewTargetPort}`,
          '--target-port',
          String(previewTargetPort),
          '--no-open',
        ]

        if (requestedPort !== undefined && !Number.isNaN(requestedPort)) {
          netlifyArgs.push('--port', String(requestedPort))
        }

        yield* cmd(['bunx', ...netlifyArgs], {
          logDir: `${docsPath}/logs`,
          env: {
            NODE_ENV: 'production',
          },
        }).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))
      }),
    ),
    Cli.Command.make(
      'deploy',
      {
        // TODO clean up when Effect CLI boolean flag is fixed
        prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false), Cli.Options.optional),
        alias: Cli.Options.text('alias').pipe(Cli.Options.optional),
        site: Cli.Options.text('site').pipe(Cli.Options.optional),
        purgeCdn: Cli.Options.boolean('purge-cdn').pipe(
          Cli.Options.withDefault(false),
          Cli.Options.withDescription('Purge the Netlify CDN cache after deploying'),
        ),
        build: Cli.Options.boolean('build').pipe(
          Cli.Options.withDefault(false),
          Cli.Options.optional,
          Cli.Options.withDescription('Build the docs before deploying (split flow)'),
        ),
      },
      Effect.fn(
        function* ({ prod: prodOption, alias: aliasOption, site: siteOption, purgeCdn, build: buildOption }) {
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
            return yield* cmdText('git rev-parse --abbrev-ref HEAD').pipe(
              Effect.provide(LivestoreWorkspace.toCwd('docs')),
              Effect.map((name) => name.trim()),
            )
          })

          yield* Effect.log(`Branch name: "${branchName}"`)

          const devBranchName = 'dev'

          const site =
            siteOption._tag === 'Some'
              ? siteOption.value
              : branchName === 'main'
                ? 'livestore-docs' // Prod site
                : 'livestore-docs-dev' // Dev site

          const isPr = isGithubAction && process.env.GITHUB_EVENT_NAME === 'pull_request'
          const prNumber = (() => {
            const ref = process.env.GITHUB_REF
            if (typeof ref === 'string') {
              const match = ref.match(/refs\/pull\/(\d+)\//)
              if (match?.[1]) return match[1]
            }
            return undefined
          })()
          const shortSha = yield* cmdText('git rev-parse --short HEAD').pipe(
            Effect.provide(LivestoreWorkspace.toCwd('docs')),
            Effect.map((s) => s.trim()),
          )
          const repo = process.env.GITHUB_REPOSITORY ?? 'livestorejs/livestore'
          const fullSha =
            process.env.GITHUB_SHA ??
            (yield* cmdText('git rev-parse HEAD').pipe(
              Effect.provide(LivestoreWorkspace.toCwd('docs')),
              Effect.map((s) => s.trim()),
            ))
          const runId = process.env.GITHUB_RUN_ID
          const commitUrl = `https://github.com/${repo}/commit/${fullSha}`
          const prUrl = prNumber ? `https://github.com/${repo}/pull/${prNumber}` : undefined
          const runUrl = runId ? `https://github.com/${repo}/actions/runs/${runId}` : undefined

          const contextLabelFor = (isProd: boolean, a: string) => (isProd ? 'prod' : `alias:${a}`)
          const buildMessage = (ctx: string) =>
            [
              'docs deploy',
              `context: ${ctx}`,
              `branch: ${branchName}`,
              `commit: ${shortSha} ${commitUrl}`,
              prNumber ? `pr: #${prNumber} ${prUrl}` : undefined,
              runUrl ? `run: ${runUrl}` : undefined,
            ]
              .filter((p): p is string => typeof p === 'string')
              .join(' | ')

          const alias = (() => {
            if (aliasOption._tag === 'Some') return aliasOption.value
            if (isPr && prNumber !== undefined) return `pr-${prNumber}-${shortSha}`
            return branchName.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          })()

          const prod =
            prodOption._tag === 'Some' && prodOption.value === true // TODO clean up when Effect CLI boolean flag is fixed
              ? prodOption.value
              : isPr
                ? false
                : branchName === 'main' || branchName === devBranchName

          if (prod && site === 'livestore-docs' && liveStoreVersion.includes('dev')) {
            return yield* Effect.die('Cannot deploy docs for dev version of LiveStore to prod')
          }

          yield* Effect.log(`Deploying to "${site}" ${prod ? 'in prod' : `with alias (${alias})`}`)

          // Split mode: build first only when requested via --build
          const shouldBuild = buildOption._tag === 'Some' && buildOption.value === true
          if (shouldBuild) {
            yield* docsBuildCommand.handler({ apiDocs: true, clean: false, skipDeps: false })
          }

          const finalDeploy: NetlifyDeploySummary = yield* deployToNetlify({
            site,
            target: prod ? { _tag: 'prod' } : { _tag: 'alias', alias },
            message: buildMessage(contextLabelFor(prod, alias)),
          }).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))

          // Verify root returns Markdown on Accept negotiation
          const rootContentType = yield* HttpClient.execute(
            HttpClientRequest.get(`${finalDeploy.deploy_url}/`).pipe(
              HttpClientRequest.setHeaders({ Accept: 'text/markdown' }),
            ),
          ).pipe(Effect.map((res) => res.headers['content-type']))

          if (!rootContentType?.toLowerCase().includes('text/markdown')) {
            return shouldNeverHappen('Docs deploy validation failed: markdown negotiation at root')
          }

          if (purgeCdn) {
            const purgeSiteId = finalDeploy.site_id
            yield* purgeNetlifyCdn({ siteId: purgeSiteId, siteSlug: site })
          }

          yield* appendGithubSummaryMarkdown({
            markdown: formatDocsDeploymentSummaryMarkdown({
              site,
              alias,
              prod,
              purgeCdn,
              draftDeploy: finalDeploy,
              finalDeploy,
            }),
            context: 'docs deployment',
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
