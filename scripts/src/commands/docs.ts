import fs from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { liveStoreVersion } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, HttpClient, HttpClientRequest } from '@livestore/utils/effect'
import { Cli, getFreePort } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'
import { buildDiagrams } from '@local/astro-tldraw'
import { createSnippetsCommand } from '@local/astro-twoslash-code'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'
import { deployToNetlify, purgeNetlifyCdn } from '../shared/netlify.ts'

const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const docsPath = `${workspaceRoot}/docs`
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

const docsSnippetsCommand = createSnippetsCommand({ projectRoot: docsPath })

const docsDiagramsCommand = Cli.Command.make('diagrams', {}, () =>
  Effect.promise(() => buildDiagrams({ projectRoot: docsPath, verbose: true })),
).pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('build', {}, () => Effect.promise(() => buildDiagrams({ projectRoot: docsPath, verbose: true }))),
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

const docsBuildCommand = Cli.Command.make(
  'build',
  {
    apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Remove docs build artifacts before compilation'),
    ),
    skipSnippets: Cli.Options.boolean('skip-snippets').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Skip the Twoslash snippet prebuild step'),
    ),
  },
  Effect.fn(function* ({ apiDocs, clean, skipSnippets }) {
    if (clean) {
      yield* cmd('rm -rf dist .astro tsconfig.tsbuildinfo', { cwd: docsPath, shell: true })
    }

    // Always clean up .netlify folder as it can cause issues with the build
    yield* cmd('rm -rf .netlify', { cwd: docsPath })

    // Derive Puppeteer's executable from Playwright's Nix-provided bundle so
    // puppeteer doesn't try to download a browser. Set before Astro spins up
    // the Vite SSR runner so transitive imports (e.g. tldraw-cli) see it.
    const derivePuppeteerExecutable = (): string | undefined => {
      const existing = process.env.PUPPETEER_EXECUTABLE_PATH
      if (existing && existing !== '') return existing
      const pwBase = process.env.PLAYWRIGHT_BROWSERS_PATH
      if (pwBase && pwBase !== '') {
        try {
          const entries = fsSync
            .readdirSync(pwBase, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('chromium-'))
            .map((d) => d.name)
            .sort()
            .reverse()
          for (const dir of entries) {
            const candidate = path.join(
              pwBase,
              dir,
              process.platform === 'linux'
                ? path.join('chrome-linux', 'chrome')
                : process.platform === 'darwin'
                  ? path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
                  : path.join('chrome-win', 'chrome.exe'),
            )
            if (fsSync.existsSync(candidate)) return candidate
          }
        } catch {}
      }
      return undefined
    }

    const puppeteerExecutable = derivePuppeteerExecutable()

    // Local/CI prebuild uses Astro directly. The deploy step performs the
    // Netlify build (single build overall), which handles Edge bundling.
    yield* cmd('pnpm astro build', {
      cwd: docsPath,
      env: {
        STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined,
        // Building the docs sometimes runs out of memory, so we give it more
        NODE_OPTIONS: '--max_old_space_size=4096',
        LS_TWOSLASH_SKIP_AUTO_BUILD: skipSnippets ? '1' : undefined,
        PUPPETEER_SKIP_DOWNLOAD: '1',
        PUPPETEER_EXECUTABLE_PATH: puppeteerExecutable,
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
        Effect.asVoid(
          cmd(['pnpm', 'astro', 'dev', open ? '--open' : undefined], {
            cwd: docsPath,
            logDir: `${docsPath}/logs`,
          }),
        ),
    ),
    docsBuildCommand,
    docsSnippetsCommand,
    docsDiagramsCommand,
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
          yield* docsBuildCommand.handler({ apiDocs: false, clean: false, skipSnippets: false })
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
          cwd: docsPath,
          logDir: `${docsPath}/logs`,
          env: {
            NODE_ENV: 'production',
          },
        })
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

          const isPr = isGithubAction && process.env.GITHUB_EVENT_NAME === 'pull_request'
          const prNumber = (() => {
            const ref = process.env.GITHUB_REF
            if (typeof ref === 'string') {
              const match = ref.match(/refs\/pull\/(\d+)\//)
              if (match?.[1]) return match[1]
            }
            return undefined
          })()
          const shortSha = yield* cmdText('git rev-parse --short HEAD').pipe(Effect.map((s) => s.trim()))
          const repo = process.env.GITHUB_REPOSITORY ?? 'livestorejs/livestore'
          const fullSha =
            process.env.GITHUB_SHA ?? (yield* cmdText('git rev-parse HEAD').pipe(Effect.map((s) => s.trim())))
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
            yield* docsBuildCommand.handler({ apiDocs: true, clean: false, skipSnippets: false })
          }

          const finalDeploy: NetlifyDeploySummary = yield* deployToNetlify({
            site,
            target: prod ? { _tag: 'prod' } : { _tag: 'alias', alias },
            cwd: docsPath,
            message: buildMessage(contextLabelFor(prod, alias)),
          })

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
