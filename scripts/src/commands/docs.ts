import fs from 'node:fs'

import { liveStoreVersion } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Duration, Effect, HttpClient, HttpClientRequest, Schedule, Schema } from '@livestore/utils/effect'
import { Cli, getFreePort } from '@livestore/utils/node'
import { buildDiagrams, watchDiagrams } from '@local/astro-tldraw'
import { buildSnippets, createSnippetsCommand } from '@local/astro-twoslash-code'

import {
  assertProductionDeployAllowed,
  DOCS_DEV_SITE,
  DOCS_DEV_URL,
  DOCS_PROD_SITE,
  DOCS_PROD_URL,
  isPrimaryIntegrationBranch,
} from '../shared/deploy-target.ts'
import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'
import { deployToNetlify, purgeNetlifyCdn } from '../shared/netlify.ts'
import { emitWorkflowReportRecord, nowIsoUtc } from '../shared/workflow-report.ts'
import { exportMarkdownCommand } from './docs-export.ts'

const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const docsPath = `${workspaceRoot}/docs`
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

/**
 * Where the prod deploy phases (`upload` → `verify` → `purge`) exchange state.
 *
 * Each prod-deploy phase runs as its own Nix task (and its own GitHub Actions
 * step / workflow_call job) so we can scope shell timeouts + heartbeats at the
 * OS boundary instead of inheriting an orphaned tldraw/Chromium child from a
 * preceding build step. The phases share Netlify identifiers via this file.
 */
const PROD_DEPLOY_STATE_DIR = `${workspaceRoot}/tmp/ci-docs-prod`
const PROD_DEPLOY_STATE_FILE = `${PROD_DEPLOY_STATE_DIR}/deploy-state.json`

/**
 * Tagged so callers can match the per-phase Effect-level timeout independently
 * from a Netlify error or a shell `timeout(1)` kill (which surfaces as exit
 * code 124 / 137 outside Effect).
 */
class DocsPhaseTimeoutError extends Schema.TaggedError<DocsPhaseTimeoutError>()('DocsPhaseTimeoutError', {
  phase: Schema.String,
  durationMs: Schema.Number,
}) {}

const ProdDeployStateSchema = Schema.Struct({
  site: Schema.String,
  siteId: Schema.String,
  deployId: Schema.String,
  deployUrl: Schema.String,
  branchName: Schema.String,
  shortSha: Schema.String,
  fullSha: Schema.String,
  runId: Schema.optional(Schema.String),
})
type ProdDeployState = typeof ProdDeployStateSchema.Type

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

type PrDeployAliases = {
  /** Sticky alias that stays constant for all commits in a PR (e.g. `pr-123`) */
  stickyAlias: string
  /** Commit-specific alias unique to each commit (e.g. `pr-123-abc1234`) */
  commitAlias: string
}

const formatDocsDeploymentSummaryMarkdown = ({
  site,
  prod,
  purgeCdn,
  prAliases,
  branchAlias,
  stickyDeploy,
  commitDeploy,
}: {
  site: string
  prod: boolean
  purgeCdn: boolean
  /** For PR deploys: both sticky and commit-specific aliases */
  prAliases: PrDeployAliases | undefined
  /** For non-PR branch deploys: the branch alias */
  branchAlias: string | undefined
  /** Deploy result with sticky PR alias (same as commitDeploy for non-PR deploys) */
  stickyDeploy: NetlifyDeploySummary
  /** Deploy result with commit-specific alias (or prod/branch deploy) */
  commitDeploy: NetlifyDeploySummary
}) => {
  const rows: Array<ReadonlyArray<string>> = []

  if (prAliases !== undefined) {
    /** PR deployment: show both sticky and commit-specific aliases */
    rows.push([
      'sticky',
      site,
      stickyDeploy.deploy_id,
      stickyDeploy.deploy_url,
      `alias: ${prAliases.stickyAlias} (stable for PR)`,
    ])
    const commitNotes: string[] = [`alias: ${prAliases.commitAlias}`]
    if (purgeCdn === true) commitNotes.push('CDN purged')
    rows.push(['commit', site, commitDeploy.deploy_id, commitDeploy.deploy_url, commitNotes.join(', ')])
  } else {
    /** Non-PR deployment: single row */
    const notes: string[] = []
    if (prod === false && branchAlias !== undefined) {
      notes.push(`alias: ${branchAlias}`)
    }
    if (purgeCdn === true) {
      notes.push('CDN purged')
    }
    rows.push([
      prod === true ? 'prod' : 'alias',
      site,
      commitDeploy.deploy_id,
      commitDeploy.deploy_url,
      notes.length > 0 ? notes.join(', ') : '—',
    ])
  }

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
const cleanupChromiumChildren = Effect.fn('docs.cleanup-chromium-children')(function* () {
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

/**
 * Emit a GitHub Actions `::notice` line every `intervalMs` so a hung phase
 * still produces visible CI output (and a wall-clock anchor in retrospective
 * log analysis). Lives in the parent scope; cancelled automatically when the
 * scope closes.
 */
const startHeartbeat = ({ phase, intervalMs = 30_000 }: { phase: string; intervalMs?: number }) =>
  Effect.gen(function* () {
    const startedAtMs = Date.now()
    yield* Effect.repeat(
      Effect.sync(() => {
        const elapsedSec = Math.round((Date.now() - startedAtMs) / 1000)
        // `::notice` is rendered as an annotation in the Actions UI and is greppable in logs.
        console.log(`::notice title=docs-deploy-heartbeat::phase=${phase} elapsed=${elapsedSec}s`)
      }),
      Schedule.spaced(Duration.millis(intervalMs)),
    ).pipe(Effect.forkScoped)
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
    netlify: Cli.Options.boolean('netlify').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription(
        'Build via `netlify build` so the SSR serverless + edge functions are bundled (deploy-ready). A plain `astro build` emits an un-bundled function that 502s once deployed via netlify deploy.',
      ),
    ),
  },
  Effect.fn('docs.build')(function* ({ apiDocs, clean, skipDeps, netlify }) {
    if (clean === true) {
      // Wipe Astro output plus cached diagram/snippet artefacts to avoid stale renders between builds.
      yield* cmd(
        'rm -rf dist .astro tsconfig.tsbuildinfo node_modules/.astro-tldraw node_modules/.astro-twoslash-code .cache/snippets',
        { shell: true },
      ).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))
    }

    // Always clean up .netlify folder as it can cause issues with the build
    yield* cmd('rm -rf .netlify').pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))

    if (skipDeps === false) {
      yield* Effect.log('Building snippets and diagrams...')
      yield* Effect.all([buildSnippets({ projectRoot: docsPath }), runDocsDiagramsBuild], {
        concurrency: 'unbounded',
      })
      yield* Effect.log('Snippets and diagrams built successfully')
      yield* cleanupChromiumChildren()
    }

    // Two build paths, same Astro build underneath:
    // - default `pnpm astro build`: emits the static site to `dist/` plus the
    //   un-bundled SSR function under `.netlify/v1/`. Fine for local/dev.
    // - `--netlify` → `netlify build`: runs the same `astro build` (via the
    //   `[build] command` in netlify.toml) and then bundles the serverless +
    //   edge functions with their deps, producing a deploy-ready output. This
    //   is what the deploy must use — a plain `astro build` deploy ships an
    //   un-bundled function that fails at runtime with ERR_MODULE_NOT_FOUND and
    //   returns a 502 on every on-demand route and the 404 fallback.
    //   `--offline` keeps the bundling step from requiring Netlify auth/link.
    const buildCommand = netlify === true ? 'bunx netlify-cli build --offline' : 'pnpm astro build'
    yield* cmd(buildCommand, {
      env: {
        STARLIGHT_INCLUDE_API_DOCS: apiDocs === true ? '1' : undefined,
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

/** Persist Netlify identifiers from the upload phase so `verify` and `purge` jobs can read them. */
const writeProdDeployState = (state: ProdDeployState) =>
  Effect.sync(() => {
    fs.mkdirSync(PROD_DEPLOY_STATE_DIR, { recursive: true })
    fs.writeFileSync(PROD_DEPLOY_STATE_FILE, JSON.stringify(state, null, 2))
  }).pipe(Effect.withSpan('docs.deploy.state.write', { attributes: { path: PROD_DEPLOY_STATE_FILE } }))

const readProdDeployState = Effect.gen(function* () {
  if (fs.existsSync(PROD_DEPLOY_STATE_FILE) === false) {
    return yield* Effect.dieMessage(
      `Prod deploy state file missing at ${PROD_DEPLOY_STATE_FILE}. Did the upload phase run?`,
    )
  }
  const content = fs.readFileSync(PROD_DEPLOY_STATE_FILE, 'utf8')
  return yield* Schema.decode(Schema.parseJson(ProdDeployStateSchema))(content)
}).pipe(Effect.withSpan('docs.deploy.state.read', { attributes: { path: PROD_DEPLOY_STATE_FILE } }))

/**
 * Post-deploy markdown content-type negotiation. The HTTP probe itself is bounded by
 * `Effect.timeout(60s)` because the Netlify CDN can take a few seconds to start serving
 * the freshly published root, and we don't want a hung edge to block the publish
 * pipeline (see livestorejs/livestore#1279, #1280).
 *
 * Failure semantics:
 * - Timeout or transport error: non-fatal (CDN warming / transient). Logged as
 *   `::warning::` so it surfaces in the Actions UI without failing the deploy.
 * - Wrong content-type returned: fatal. The Edge function being misconfigured is
 *   a real release-breaking bug that should fail the publish.
 */
const verifyMarkdownNegotiation = (deployUrl: string) =>
  Effect.gen(function* () {
    const rootContentType = yield* HttpClient.execute(
      HttpClientRequest.get(`${deployUrl}/`).pipe(HttpClientRequest.setHeaders({ Accept: 'text/markdown' })),
    ).pipe(
      Effect.map((res) => res.headers['content-type']),
      Effect.timeout(Duration.seconds(60)),
      Effect.catchTag('TimeoutException', () =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `::warning::Markdown negotiation request at ${deployUrl}/ timed out after 60s (treated as non-fatal; the Netlify deploy itself succeeded).`,
          )
          return undefined
        }),
      ),
      // Transport errors (5xx from edge, network blip, etc.) are still non-fatal —
      // the deploy is live and the markdown probe is a sanity check, not a release gate.
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `::warning::Markdown negotiation request at ${deployUrl}/ failed: ${String(error)} (treated as non-fatal).`,
          )
          return undefined
        }),
      ),
    )

    if (rootContentType !== undefined && rootContentType.toLowerCase().includes('text/markdown') === false) {
      return shouldNeverHappen(
        `Docs deploy validation failed: markdown negotiation at root returned ${rootContentType}`,
      )
    }

    yield* Effect.log(`Markdown negotiation OK at ${deployUrl}/ (content-type=${rootContentType ?? 'probe-skipped'})`)
  }).pipe(Effect.withSpan('docs.deploy.verify.markdown-negotiation', { attributes: { deployUrl } }))

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
      Effect.fn('docs.dev')(function* ({ open, skipDeps }) {
        if (skipDeps === false) {
          yield* Effect.log('Building snippets and diagrams...')
          yield* Effect.all([buildSnippets({ projectRoot: docsPath }), runDocsDiagramsBuild], {
            concurrency: 'unbounded',
          })
          yield* Effect.log('Snippets and diagrams built successfully')
        }

        if (skipDeps === false) {
          yield* runDocsDiagramsWatchNoInitialBuild.pipe(
            Effect.catchAllCause((cause) => Effect.logWarning('Diagrams watch stopped', cause)),
            Effect.forkScoped,
          )
        }

        /* Run Astro dev server */
        yield* cmd(['pnpm', 'astro', 'dev', open === true ? '--open' : undefined], {
          logDir: `${docsPath}/logs`,
        }).pipe(Effect.provide(LivestoreWorkspace.toCwd('docs')))
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
      Effect.fn('docs.preview')(function* ({ port: portOption, build }) {
        if (build === true) {
          yield* docsBuildCommand.handler({ apiDocs: false, clean: false, skipDeps: false })
        }

        const requestedPort = portOption._tag === 'Some' ? Number.parseInt(portOption.value, 10) : undefined
        const previewTargetPort = yield* getFreePort

        const distPath = `${docsPath}/dist`
        if (fs.existsSync(distPath) === false) {
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

        if (requestedPort !== undefined && Number.isNaN(requestedPort) === false) {
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
        plan: Cli.Options.boolean('plan').pipe(
          Cli.Options.withDefault(false),
          Cli.Options.optional,
          Cli.Options.withDescription('Print the resolved deploy plan without building or deploying'),
        ),
        /**
         * Phase split for the prod deploy. The release CI runs each phase as a
         * separate Nix task / GitHub Actions step so a hang in `upload` (e.g.
         * an orphan Chromium left from build) cannot freeze `verify`/`purge`.
         *
         * - `upload`: build (if `--build`) + Netlify deploy. Writes deploy IDs to
         *   `tmp/ci-docs-prod/deploy-state.json`.
         * - `verify`: reads state, posts the GitHub job summary + workflow report.
         *   Markdown content-type probe is non-fatal and runs in both `upload`
         *   and `verify` (cheap, gives extra wall-clock coverage).
         * - `purge`: reads state, purges the Netlify CDN cache.
         * - `all` (default): runs the legacy single-process pipeline so dev
         *   surfaces and ad-hoc usage are unaffected.
         */
        step: Cli.Options.choice('step', ['all', 'upload', 'verify', 'purge'] as const).pipe(
          Cli.Options.withDefault('all' as const),
          Cli.Options.withDescription('Run only one phase of the prod deploy pipeline (used by CI)'),
        ),
      },
      Effect.fn('docs.deploy')(
        function* ({
          prod: prodOption,
          alias: aliasOption,
          site: siteOption,
          purgeCdn,
          build: buildOption,
          plan,
          step,
        }) {
          // In CI, fork a heartbeat fiber so a hung HTTP call or netlify CLI
          // still produces visible output every 30s. The fiber is scoped to the
          // handler (via the outer `Effect.scoped` wrapper applied below), so
          // it is interrupted when the handler returns or fails.
          if (isGithubAction === true) {
            yield* startHeartbeat({ phase: `step=${step}` })
          }

          // `verify` and `purge` are stateless w.r.t. the local repo: they read the
          // state file written by `upload` and only need Netlify credentials.
          if (step === 'verify') {
            return yield* runVerifyPhase()
          }
          if (step === 'purge') {
            return yield* runPurgePhase()
          }

          const branchName = yield* Effect.gen(function* () {
            if (isGithubAction === true) {
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

          const isPr = isGithubAction && process.env.GITHUB_EVENT_NAME === 'pull_request'
          const explicitProd = prodOption._tag === 'Some' && prodOption.value === true

          const site =
            siteOption._tag === 'Some' ? siteOption.value : explicitProd === true ? DOCS_PROD_SITE : DOCS_DEV_SITE

          if (explicitProd === true) {
            yield* Effect.sync(() => assertProductionDeployAllowed(liveStoreVersion))
          }

          const prNumber = (() => {
            const ref = process.env.GITHUB_REF
            if (typeof ref === 'string') {
              const match = ref.match(/refs\/pull\/(\d+)\//)
              if (match?.[1] !== undefined) return match[1]
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
          const prUrl = prNumber !== undefined ? `https://github.com/${repo}/pull/${prNumber}` : undefined
          const runUrl = runId !== undefined ? `https://github.com/${repo}/actions/runs/${runId}` : undefined

          const contextLabelFor = (isProd: boolean, a: string) => (isProd === true ? 'prod' : `alias:${a}`)
          const buildMessage = (ctx: string) =>
            [
              'docs deploy',
              `context: ${ctx}`,
              `branch: ${branchName}`,
              `commit: ${shortSha} ${commitUrl}`,
              prNumber !== undefined ? `pr: #${prNumber} ${prUrl}` : undefined,
              runUrl !== undefined ? `run: ${runUrl}` : undefined,
            ]
              .filter((p): p is string => typeof p === 'string')
              .join(' | ')

          /**
           * For PRs: create both a sticky alias (stable for PR lifetime) and a commit-specific alias
           * For non-PRs: use the explicit alias option or derive from branch name
           */
          const prAliases: PrDeployAliases | undefined =
            isPr === true && prNumber !== undefined && aliasOption._tag === 'None'
              ? { stickyAlias: `pr-${prNumber}`, commitAlias: `pr-${prNumber}-${shortSha}` }
              : undefined

          const branchAlias =
            aliasOption._tag === 'Some'
              ? aliasOption.value
              : prAliases === undefined
                ? branchName.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase()
                : undefined

          const prod =
            explicitProd === true // TODO clean up when Effect CLI boolean flag is fixed
              ? true
              : isPr === true
                ? false
                : site === DOCS_DEV_SITE && isPrimaryIntegrationBranch(branchName)

          const deployAliasLabel =
            prAliases !== undefined
              ? `with PR aliases (${prAliases.stickyAlias}, ${prAliases.commitAlias})`
              : branchAlias !== undefined
                ? `with alias (${branchAlias})`
                : ''
          yield* Effect.log(`Deploying to "${site}" ${prod === true ? 'in prod' : deployAliasLabel}`)

          // Split mode: build first only when requested via --build
          const shouldBuild = buildOption._tag === 'Some' && buildOption.value === true
          const docsSiteUrl = site === DOCS_PROD_SITE ? DOCS_PROD_URL : DOCS_DEV_URL

          const shouldPrintPlan = plan._tag === 'Some' && plan.value === true

          if (shouldPrintPlan === true) {
            console.log(
              JSON.stringify(
                {
                  branchName,
                  isPr,
                  liveStoreVersion,
                  site,
                  siteUrl: docsSiteUrl,
                  build: shouldBuild,
                  deployTarget:
                    prAliases !== undefined
                      ? { _tag: 'pr-aliases', ...prAliases }
                      : prod === true
                        ? { _tag: 'prod' }
                        : { _tag: 'alias', alias: branchAlias },
                  purgeCdn,
                  step,
                },
                null,
                2,
              ),
            )
            return
          }

          if (shouldBuild === true) {
            process.env.LIVESTORE_DOCS_SITE_URL = docsSiteUrl
            yield* docsBuildCommand.handler({ apiDocs: true, clean: false, skipDeps: false })
          }

          const docsWorkspaceCwd = Effect.provide(LivestoreWorkspace.toCwd('docs'))

          /**
           * For PR deploys: deploy twice to create both sticky and commit-specific aliases.
           * For non-PR deploys: deploy once with prod or branch alias.
           */
          const { stickyDeploy, commitDeploy } = yield* Effect.gen(function* () {
            if (prAliases !== undefined) {
              /** PR deploy: first create sticky alias, then commit-specific alias */
              const stickyPrDeploy: NetlifyDeploySummary = yield* deployToNetlify({
                site,
                target: { _tag: 'alias', alias: prAliases.stickyAlias },
                message: buildMessage(contextLabelFor(false, prAliases.stickyAlias)),
              }).pipe(docsWorkspaceCwd)

              const commitPrDeploy: NetlifyDeploySummary = yield* deployToNetlify({
                site,
                target: { _tag: 'alias', alias: prAliases.commitAlias },
                message: buildMessage(contextLabelFor(false, prAliases.commitAlias)),
              }).pipe(docsWorkspaceCwd)

              return { stickyDeploy: stickyPrDeploy, commitDeploy: commitPrDeploy }
            } else {
              /** Non-PR deploy: single deploy with prod or branch alias */
              const deploy: NetlifyDeploySummary = yield* deployToNetlify({
                site,
                target: prod === true ? { _tag: 'prod' } : { _tag: 'alias', alias: branchAlias! },
                message: buildMessage(contextLabelFor(prod, branchAlias ?? '')),
              }).pipe(docsWorkspaceCwd)

              return { stickyDeploy: deploy, commitDeploy: deploy }
            }
          }).pipe(Effect.withSpan('docs.deploy.upload', { attributes: { site, prod } }))

          // For phased prod deploys (`--step=upload`), persist enough state for the
          // verify/purge phases to reconstitute the report and target the right site.
          if (step === 'upload' && prod === true) {
            yield* writeProdDeployState({
              site,
              siteId: commitDeploy.site_id,
              deployId: commitDeploy.deploy_id,
              deployUrl: commitDeploy.deploy_url,
              branchName,
              shortSha,
              fullSha,
              runId,
            })
            yield* Effect.log(`Wrote prod deploy state to ${PROD_DEPLOY_STATE_FILE}`)
            return
          }

          // Verify root returns Markdown on Accept negotiation (use commitDeploy URL as canonical).
          // `verifyMarkdownNegotiation` wraps the request in `Effect.timeout(60s)` + non-fatal fallback
          // — the Netlify deploy is the source of truth, the CDN sometimes needs a few seconds to
          // start serving the freshly published root (see livestorejs/livestore#1279, #1280).
          yield* verifyMarkdownNegotiation(commitDeploy.deploy_url)

          if (purgeCdn === true) {
            const purgeSiteId = commitDeploy.site_id
            yield* purgeNetlifyCdn({ siteId: purgeSiteId, siteSlug: site }).pipe(
              Effect.timeout(Duration.seconds(60)),
              Effect.catchTag('TimeoutException', () =>
                Effect.logWarning(
                  `::warning::Netlify CDN purge for site ${site} timed out after 60s; deploy is live regardless (see livestorejs/livestore#1279).`,
                ),
              ),
              // Any other failure (auth, network) is also non-fatal — the deploy is live
              // regardless of CDN purge state, the purge just shortens the stale-content window.
              Effect.catchAll((error) =>
                Effect.logWarning(`::warning::Netlify CDN purge failed for ${site}: ${String(error)} (non-fatal)`),
              ),
            )
          }

          yield* appendGithubSummaryMarkdown({
            markdown: formatDocsDeploymentSummaryMarkdown({
              site,
              prod,
              purgeCdn,
              prAliases,
              branchAlias,
              stickyDeploy,
              commitDeploy,
            }),
            context: 'docs deployment',
          })

          /**
           * Surface the docs deploy as a workflow-report record so the managed
           * PR comment aggregator can pick it up alongside other deploy/publish
           * reports. For PR deploys we expose both commit-specific and sticky
           * aliases (primary link is the commit alias so reviewers always see
           * the SHA they pushed).
           */
          const docsLinks: Array<{ label: string; url: string; primary?: boolean }> = [
            { label: 'Docs preview', url: commitDeploy.deploy_url, primary: true },
          ]
          if (prAliases !== undefined && stickyDeploy.deploy_url !== commitDeploy.deploy_url) {
            docsLinks.push({ label: 'Docs preview (sticky)', url: stickyDeploy.deploy_url })
          }
          if (runUrl !== undefined) {
            docsLinks.push({ label: 'Workflow run', url: runUrl })
          }

          yield* emitWorkflowReportRecord({
            _tag: 'WorkflowReportRecord',
            schemaVersion: 1,
            id: `docs-deploy-${fullSha}`,
            kind: 'docs-deploy-preview',
            subject: { id: 'livestore-docs-preview', label: 'LiveStore docs preview' },
            status: 'success',
            title: prod === true ? 'Docs deployed to production' : `Docs preview deployed (${site})`,
            summary: prAliases !== undefined ? `PR aliases: ${prAliases.commitAlias}, ${prAliases.stickyAlias}` : site,
            createdAtUtc: nowIsoUtc(),
            links: docsLinks,
            data: {
              site,
              prod,
              deployId: commitDeploy.deploy_id,
              commitUrl: commitDeploy.deploy_url,
              ...(prAliases !== undefined
                ? { stickyAlias: prAliases.stickyAlias, commitAlias: prAliases.commitAlias }
                : {}),
              ...(branchAlias !== undefined ? { branchAlias } : {}),
              sha: fullSha,
            },
          })
        },
        Effect.catchIf(
          (e) => e._tag === 'NetlifyError' && e.reason === 'auth',
          () => Effect.logWarning('::warning Not logged in to Netlify'),
        ),
        // Scope the handler so the heartbeat fiber is interrupted on return/error.
        Effect.scoped,
      ),
    ),
  ]),
)

/**
 * Stand-alone `verify` phase: read the upload-phase state, run the markdown
 * content-type probe, emit the GitHub job summary, and surface the deploy as
 * a workflow-report record. Idempotent — safe to re-run if the upload phase
 * succeeded but verify needs a retry.
 */
const runVerifyPhase = Effect.fn('docs.deploy.verify')(function* () {
  const state = yield* readProdDeployState
  yield* Effect.log(`Verifying prod docs deploy: ${state.deployUrl} (deployId=${state.deployId})`)

  yield* verifyMarkdownNegotiation(state.deployUrl)

  const repo = process.env.GITHUB_REPOSITORY ?? 'livestorejs/livestore'
  const runUrl = state.runId !== undefined ? `https://github.com/${repo}/actions/runs/${state.runId}` : undefined

  const stickyDeploy = {
    site_id: state.siteId,
    site_name: state.site,
    deploy_id: state.deployId,
    deploy_url: state.deployUrl,
    logs: '',
  }

  yield* appendGithubSummaryMarkdown({
    markdown: formatDocsDeploymentSummaryMarkdown({
      site: state.site,
      prod: true,
      purgeCdn: false, // purge runs in a later phase; the markdown table is regenerated then
      prAliases: undefined,
      branchAlias: undefined,
      stickyDeploy,
      commitDeploy: stickyDeploy,
    }),
    context: 'docs deployment (verify phase)',
  })

  const links: Array<{ label: string; url: string; primary?: boolean }> = [
    { label: 'Docs preview', url: state.deployUrl, primary: true },
  ]
  if (runUrl !== undefined) {
    links.push({ label: 'Workflow run', url: runUrl })
  }

  yield* emitWorkflowReportRecord({
    _tag: 'WorkflowReportRecord',
    schemaVersion: 1,
    id: `docs-deploy-${state.fullSha}`,
    kind: 'docs-deploy-preview',
    subject: { id: 'livestore-docs-preview', label: 'LiveStore docs preview' },
    status: 'success',
    title: 'Docs deployed to production',
    summary: state.site,
    createdAtUtc: nowIsoUtc(),
    links,
    data: {
      site: state.site,
      prod: true,
      deployId: state.deployId,
      commitUrl: state.deployUrl,
      sha: state.fullSha,
    },
  })
})

/**
 * Stand-alone `purge` phase: read the upload-phase state and purge the
 * Netlify CDN cache. CDN purge failures are non-fatal — the deploy is already
 * live, the purge just shortens the window in which stale content is served.
 */
const runPurgePhase = Effect.fn('docs.deploy.purge')(function* () {
  const state = yield* readProdDeployState
  yield* Effect.log(`Purging Netlify CDN for prod docs: site=${state.site} siteId=${state.siteId}`)

  yield* purgeNetlifyCdn({ siteId: state.siteId, siteSlug: state.site }).pipe(
    Effect.timeout(Duration.seconds(60)),
    Effect.catchTag('TimeoutException', () =>
      Effect.logWarning(`::warning::Netlify CDN purge timed out for ${state.site} (treated as non-fatal)`),
    ),
    Effect.catchAll((error) =>
      Effect.logWarning(`::warning::Netlify CDN purge failed for ${state.site}: ${String(error)} (non-fatal)`),
    ),
  )
})

export { DocsPhaseTimeoutError }
