import crypto from 'node:crypto'
import path from 'node:path'

import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

const OWNER = 'livestorejs'
const REPO = 'livestore'

const RulesetRequestBody = Schema.Struct({
  name: Schema.String,
  target: Schema.Literals(['branch', 'tag']),
  enforcement: Schema.Literals(['disabled', 'active', 'evaluate']),
  bypass_actors: Schema.Array(
    Schema.Struct({
      actor_id: Schema.Number,
      actor_type: Schema.Literals(['RepositoryRole', 'Team', 'Integration', 'OrganizationAdmin', 'DeployKey']),
      bypass_mode: Schema.Literals(['always', 'pull_request', 'exempt']),
    }),
  ),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.Array(Schema.String),
      exclude: Schema.Array(Schema.String),
    }),
  }),
  rules: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal('pull_request'), parameters: Schema.optional(Schema.Unknown) }),
      Schema.Struct({ type: Schema.Literal('required_status_checks'), parameters: Schema.optional(Schema.Unknown) }),
      Schema.Struct({ type: Schema.Literal('non_fast_forward') }),
      Schema.Struct({ type: Schema.Literal('deletion') }),
    ]),
  ),
})

type TRulesetRequestBody = typeof RulesetRequestBody.Type

const getRulesetFilePath = () => path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'repo-settings.json')

const loadRulesetBody = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const filePath = getRulesetFilePath()
    const raw = yield* fs.readFileString(filePath)
    const parser = Schema.fromJsonString(RulesetRequestBody)
    return yield* Schema.decodeEffect(parser)(raw)
  })

interface TExistingRuleset {
  id: number
  name: string
  enforcement: string
}

const ManagedRulesetSchema = Schema.Struct({
  name: Schema.String,
  target: Schema.Literals(['branch', 'tag']),
  enforcement: Schema.Literals(['disabled', 'active', 'evaluate']),
  bypass_actors: Schema.optional(Schema.NullOr(RulesetRequestBody.fields.bypass_actors)),
  conditions: RulesetRequestBody.fields.conditions,
  rules: RulesetRequestBody.fields.rules,
})

const normalizeRuleset = (ruleset: typeof ManagedRulesetSchema.Type): TRulesetRequestBody => ({
  name: ruleset.name,
  target: ruleset.target,
  enforcement: ruleset.enforcement,
  bypass_actors: ruleset.bypass_actors ?? [],
  conditions: ruleset.conditions,
  rules: ruleset.rules,
})

const getViewerPermission = Effect.gen(function* () {
  const response = yield* cmdText(['gh', 'repo', 'view', `${OWNER}/${REPO}`, '--json', 'viewerPermission'], {
    stderr: 'pipe',
  }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

  const ViewerPermissionSchema = Schema.fromJsonString(
    Schema.Struct({
      viewerPermission: Schema.String,
    }),
  )
  const parsed = yield* Schema.decodeEffect(ViewerPermissionSchema)(response)
  return parsed.viewerPermission
})

const getRulesetByName = (name: string) =>
  Effect.gen(function* () {
    const response = yield* cmdText(['gh', 'api', `repos/${OWNER}/${REPO}/rulesets`, '--jq', '.'], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const ExistingRulesetSchema = Schema.fromJsonString(
      Schema.Array(
        Schema.Struct({
          id: Schema.Number,
          name: Schema.String,
          enforcement: Schema.String,
        }),
      ),
    )
    const rulesets = yield* Schema.decodeEffect(ExistingRulesetSchema)(response)
    return rulesets.find((ruleset) => ruleset.name === name) ?? null
  })

const getRulesetDetails = (rulesetId: number) =>
  Effect.gen(function* () {
    const details = yield* cmdText(['gh', 'api', `repos/${OWNER}/${REPO}/rulesets/${rulesetId}`, '--jq', '.'], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const parser = Schema.fromJsonString(ManagedRulesetSchema)
    return yield* Schema.decodeEffect(parser)(details)
  })

const writeRulesetBodyToTmp = (body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = path.join(process.env.WORKSPACE_ROOT ?? '.', 'tmp', 'gh-rulesets')
    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const bodyPath = path.join(tmpDir, 'ruleset-body.json')
    const bodyJson = yield* Schema.encodeEffect(Schema.fromJsonString(RulesetRequestBody))(body)
    yield* fs.writeFileString(bodyPath, bodyJson)
    return bodyPath
  })

const createRuleset = (body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const bodyPath = yield* writeRulesetBodyToTmp(body)
    yield* cmd(['gh', 'api', '-X', 'POST', `repos/${OWNER}/${REPO}/rulesets`, '--input', bodyPath], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  })

const updateRuleset = (rulesetId: number, body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const bodyPath = yield* writeRulesetBodyToTmp(body)
    yield* cmd(['gh', 'api', '-X', 'PUT', `repos/${OWNER}/${REPO}/rulesets/${rulesetId}`, '--input', bodyPath], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  })

type TJsonValue = null | boolean | number | string | ReadonlyArray<TJsonValue> | { readonly [key: string]: TJsonValue }

const isJsonObject = (value: TJsonValue): value is { readonly [key: string]: TJsonValue } =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false

const formatPath = (pathParts: ReadonlyArray<string>) => (pathParts.length === 0 ? '$' : `$.${pathParts.join('.')}`)

const formatValue = (value: TJsonValue) => JSON.stringify(value)

const isBypassActorsDiff = (diff: string) => diff.startsWith('$.bypass_actors')

const isGitHubExpandedDefaultDiff = (diff: string) =>
  githubExpandedDefaultDiffSuffixes.some((suffix) => diff.endsWith(suffix))

/** GitHub may add inactive defaults to ruleset responses that were omitted from the request. */
const githubExpandedDefaultDiffSuffixes = [
  '.parameters.allowed_merge_methods: desired null, live ["merge","squash","rebase"]',
  '.parameters.required_reviewers: desired null, live []',
  '.parameters.dismissal_restriction: desired null, live {"allowed_actors":[],"enabled":false}',
]

const collectDiffs = (
  desired: TJsonValue,
  live: TJsonValue,
  pathParts: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  if (Object.is(desired, live) === true) return []

  if (Array.isArray(desired) === true || Array.isArray(live) === true) {
    if (Array.isArray(desired) === false || Array.isArray(live) === false) {
      return [`${formatPath(pathParts)}: desired ${formatValue(desired)}, live ${formatValue(live)}`]
    }

    const maxLength = Math.max(desired.length, live.length)
    return Array.from({ length: maxLength }).flatMap((_, index) =>
      collectDiffs(desired[index] ?? null, live[index] ?? null, [...pathParts, String(index)]),
    )
  }

  if (isJsonObject(desired) === true || isJsonObject(live) === true) {
    if (isJsonObject(desired) === false || isJsonObject(live) === false) {
      return [`${formatPath(pathParts)}: desired ${formatValue(desired)}, live ${formatValue(live)}`]
    }

    const keys = Array.from(new Set([...Object.keys(desired), ...Object.keys(live)])).toSorted((a, b) =>
      a.localeCompare(b),
    )
    return keys.flatMap((key) => collectDiffs(desired[key] ?? null, live[key] ?? null, [...pathParts, key]))
  }

  return [`${formatPath(pathParts)}: desired ${formatValue(desired)}, live ${formatValue(live)}`]
}

const syncRulesetsCommand = Cli.Command.make(
  'sync',
  {
    dryRun: Cli.Flag.boolean('dry-run').pipe(Cli.Flag.withDefault(false)),
  },
  Effect.fn(function* ({ dryRun }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody()
    const existing = yield* getRulesetByName(body.name)
    const live = existing === null ? null : yield* getRulesetDetails(existing.id).pipe(Effect.map(normalizeRuleset))
    const diffs = live === null ? [] : collectDiffs(body as TJsonValue, live as TJsonValue)

    if (dryRun === true) {
      console.log(`Ruleset file: ${getRulesetFilePath()}`)
      console.log(`Ruleset name: ${body.name}`)
      console.log(`Existing: ${existing !== null ? `yes (id: ${existing.id})` : 'no'}`)
      console.log(`Action: ${existing !== null ? 'update' : 'create'}`)
      if (existing !== null) {
        if (diffs.length === 0) {
          console.log('Drift: none')
        } else {
          console.log('Drift:')
          for (const diff of diffs) console.log(`- ${diff}`)
        }
      }
      return
    }

    if (existing !== null) {
      yield* updateRuleset(existing.id, body)
      console.log(`Updated ruleset '${body.name}' (id: ${existing.id}) on ${OWNER}/${REPO}`)
    } else {
      yield* createRuleset(body)
      console.log(`Created ruleset '${body.name}' on ${OWNER}/${REPO}`)
    }
  }),
).pipe(Cli.Command.withDescription('Create or update repository ruleset from generated repo-settings file'))

const checkRulesetsCommand = Cli.Command.make(
  'check',
  {},
  Effect.fn(function* () {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody()
    const existing = yield* getRulesetByName(body.name)

    if (existing === null) {
      console.error(`No live ruleset found with name '${body.name}'`)
      console.error("Run 'mono github rulesets sync' to create one.")
      process.exitCode = 1
      return
    }

    const live = yield* getRulesetDetails(existing.id).pipe(Effect.map(normalizeRuleset))
    const viewerPermission = yield* getViewerPermission
    const allDiffs = collectDiffs(body as TJsonValue, live as TJsonValue).filter(
      (diff) => isGitHubExpandedDefaultDiff(diff) === false,
    )
    const diffs =
      viewerPermission === 'ADMIN' ? allDiffs : allDiffs.filter((diff) => isBypassActorsDiff(diff) === false)

    if (diffs.length === 0) {
      console.log(`Ruleset '${body.name}' is in sync with ${getRulesetFilePath()}.`)
      if (viewerPermission !== 'ADMIN' && allDiffs.some(isBypassActorsDiff) === true) {
        console.log('Bypass actor visibility requires repository admin permission; skipped bypass_actors comparison.')
      }
      return
    }

    console.error(`Ruleset '${body.name}' drift detected against ${getRulesetFilePath()}:`)
    for (const diff of diffs) console.error(`- ${diff}`)
    console.error("Run 'mono github rulesets sync' with admin permissions to reconcile it.")
    process.exitCode = 1
  }),
).pipe(Cli.Command.withDescription('Check whether the live GitHub ruleset matches the generated source file'))

const showRulesetsCommand = Cli.Command.make(
  'show',
  {},
  Effect.fn(function* () {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody()
    const existing = yield* getRulesetByName(body.name)

    if (existing == null) {
      console.log(`No ruleset found with name '${body.name}'`)
      console.log(`Run 'mono github rulesets sync' to create one.`)
      return
    }

    console.log(`Ruleset: ${existing.name}`)
    console.log(`ID: ${existing.id}`)
    console.log(`Enforcement: ${existing.enforcement}`)

    console.log('\nFull details:')
    const details = yield* getRulesetDetails(existing.id)
    console.dir(details, { depth: null })
  }),
).pipe(Cli.Command.withDescription('Show current ruleset configuration'))

const getAppManifestPath = () => path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'reconcile-app-manifest.json')

const AppManifestSchema = Schema.Struct({
  name: Schema.String,
  default_permissions: Schema.Record(Schema.String, Schema.String),
  default_events: Schema.Array(Schema.String),
})

const LiveAppSchema = Schema.Struct({
  name: Schema.String,
  permissions: Schema.Record(Schema.String, Schema.String),
  events: Schema.Array(Schema.String),
})

const toErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const base64Url = (input: Buffer | string) =>
  (Buffer.isBuffer(input) === true ? input : Buffer.from(input)).toString('base64url')

/**
 * Mints a short-lived GitHub App JWT (RS256) to authenticate `GET /app`.
 * `iat` is backdated 60s to tolerate clock skew; GitHub rejects `exp` beyond 10 minutes.
 */
const mintAppJwt = ({ appId, privateKeyPem }: { appId: string; privateKeyPem: string }) =>
  Effect.try({
    try: () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
      const payload = base64Url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }))
      const signer = crypto.createSign('RSA-SHA256')
      signer.update(`${header}.${payload}`)
      return `${header}.${payload}.${base64Url(signer.sign(privateKeyPem))}`
    },
    catch: (cause) => new Error(`Failed to mint App JWT: ${toErrorMessage(cause)}`),
  })

const fetchLiveApp = (jwt: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch('https://api.github.com/app', {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `${OWNER}-ruleset-reconciler`,
        },
      })
      if (response.ok === false) {
        throw new Error(`GET /app failed: ${response.status} ${await response.text()}`)
      }
      return (await response.json()) as unknown
    },
    catch: (cause) => new Error(toErrorMessage(cause)),
  })

/** Compares the manifest's requested permissions/events against the live App definition. */
const collectAppDiffs = (
  manifest: typeof AppManifestSchema.Type,
  live: typeof LiveAppSchema.Type,
): ReadonlyArray<string> => {
  const diffs: string[] = []
  const permKeys = Array.from(
    new Set([...Object.keys(manifest.default_permissions), ...Object.keys(live.permissions)]),
  ).toSorted((a, b) => a.localeCompare(b))
  for (const key of permKeys) {
    const desired = manifest.default_permissions[key]
    const actual = live.permissions[key]
    if (desired !== actual) {
      diffs.push(
        `permissions.${key}: manifest ${JSON.stringify(desired ?? null)}, live ${JSON.stringify(actual ?? null)}`,
      )
    }
  }
  const desiredEvents = [...manifest.default_events].toSorted((a, b) => a.localeCompare(b))
  const liveEvents = [...live.events].toSorted((a, b) => a.localeCompare(b))
  if (JSON.stringify(desiredEvents) !== JSON.stringify(liveEvents)) {
    diffs.push(`events: manifest ${JSON.stringify(desiredEvents)}, live ${JSON.stringify(liveEvents)}`)
  }
  return diffs
}

/**
 * Checks the live GitHub App's definition against the committed manifest.
 * GitHub exposes no API to update an App's permissions, so drift is reported for
 * manual reconciliation rather than auto-applied (see context/repo-ruleset-sync).
 */
const checkAppCommand = Cli.Command.make(
  'check',
  {},
  Effect.fn(function* () {
    const fs = yield* FileSystem.FileSystem
    const appId = process.env.RECONCILE_APP_ID
    const privateKeyPem = process.env.RECONCILE_APP_PRIVATE_KEY

    if (appId == null || appId === '' || privateKeyPem == null || privateKeyPem === '') {
      console.error('RECONCILE_APP_ID and RECONCILE_APP_PRIVATE_KEY must be set to check App drift.')
      process.exitCode = 1
      return
    }

    const manifestPath = getAppManifestPath()
    const manifestRaw = yield* fs.readFileString(manifestPath)
    const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(AppManifestSchema))(manifestRaw)

    const jwt = yield* mintAppJwt({ appId, privateKeyPem })
    const live = yield* fetchLiveApp(jwt).pipe(Effect.flatMap(Schema.decodeUnknownEffect(LiveAppSchema)))

    const diffs = collectAppDiffs(manifest, live)

    if (diffs.length === 0) {
      console.log(`App '${manifest.name}' definition is in sync with ${manifestPath}.`)
      return
    }

    console.error(`App definition drift detected against ${manifestPath}:`)
    for (const diff of diffs) console.error(`- ${diff}`)
    console.error(
      'GitHub has no API to update App permissions; reconcile manually in the App settings UI, then update the manifest.',
    )
    process.exitCode = 1
  }),
).pipe(Cli.Command.withDescription('Check the live GitHub App definition against the committed manifest'))

export const githubCommand = Cli.Command.make('github').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('rulesets').pipe(
      Cli.Command.withDescription('Manage repository rulesets from generated repo-settings files'),
      Cli.Command.withSubcommands([syncRulesetsCommand, checkRulesetsCommand, showRulesetsCommand]),
    ),
    Cli.Command.make('app').pipe(
      Cli.Command.withDescription('Manage the reconcile GitHub App definition from the committed manifest'),
      Cli.Command.withSubcommands([checkAppCommand]),
    ),
  ]),
)
