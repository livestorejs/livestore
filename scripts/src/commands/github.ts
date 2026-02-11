import path from 'node:path'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'

const OWNER = 'livestorejs'
const REPO = 'livestore'

const RulesetRequestBody = Schema.Struct({
  name: Schema.String,
  target: Schema.Literal('branch', 'tag'),
  enforcement: Schema.Literal('disabled', 'active', 'evaluate'),
  bypass_actors: Schema.Array(
    Schema.Struct({
      actor_id: Schema.Number,
      actor_type: Schema.Literal('RepositoryRole', 'Team', 'Integration', 'OrganizationAdmin', 'DeployKey'),
      bypass_mode: Schema.Literal('always', 'pull_request', 'exempt'),
    }),
  ),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.Array(Schema.String),
      exclude: Schema.Array(Schema.String),
    }),
  }),
  rules: Schema.Array(
    Schema.Union(
      Schema.Struct({ type: Schema.Literal('pull_request'), parameters: Schema.optional(Schema.Unknown) }),
      Schema.Struct({ type: Schema.Literal('required_status_checks'), parameters: Schema.optional(Schema.Unknown) }),
      Schema.Struct({ type: Schema.Literal('non_fast_forward') }),
      Schema.Struct({ type: Schema.Literal('deletion') }),
    ),
  ),
})

type TRulesetRequestBody = typeof RulesetRequestBody.Type
type TRulesetBranch = 'dev' | 'main'

const getRulesetFilePath = (branch: TRulesetBranch) =>
  path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', `repo-settings.${branch}.json`)

const loadRulesetBody = (branch: TRulesetBranch) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const filePath = getRulesetFilePath(branch)
    const raw = yield* fs.readFileString(filePath)
    const parser = Schema.parseJson(RulesetRequestBody)
    return yield* Schema.decode(parser)(raw)
  })

interface TExistingRuleset {
  id: number
  name: string
  enforcement: string
}

const getRulesetByName = (name: string) =>
  Effect.gen(function* () {
    const response = yield* cmdText(['gh', 'api', `repos/${OWNER}/${REPO}/rulesets`, '--jq', '.'], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const ExistingRulesetSchema = Schema.parseJson(
      Schema.Array(
        Schema.Struct({
          id: Schema.Number,
          name: Schema.String,
          enforcement: Schema.String,
        }),
      ),
    )
    const rulesets = yield* Schema.decode(ExistingRulesetSchema)(response)
    return rulesets.find((ruleset) => ruleset.name === name) ?? null
  })

const writeRulesetBodyToTmp = (body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = path.join(process.env.WORKSPACE_ROOT ?? '.', 'tmp', 'gh-rulesets')
    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const bodyPath = path.join(tmpDir, 'ruleset-body.json')
    const bodyJson = yield* Schema.encode(Schema.parseJson(RulesetRequestBody))(body)
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

const syncRulesetsCommand = Cli.Command.make(
  'sync',
  {
    branch: Cli.Options.choice('branch', ['dev', 'main'] as const).pipe(
      Cli.Options.withDescription('Ruleset variant to sync from generated repo-settings file'),
      Cli.Options.withDefault('dev'),
    ),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ branch, dryRun }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody(branch)
    const existing = yield* getRulesetByName(body.name)

    if (dryRun) {
      console.log(`Ruleset file: ${getRulesetFilePath(branch)}`)
      console.log(`Ruleset name: ${body.name}`)
      console.log(`Existing: ${existing ? `yes (id: ${existing.id})` : 'no'}`)
      console.log(`Action: ${existing ? 'update' : 'create'}`)
      return
    }

    if (existing) {
      yield* updateRuleset(existing.id, body)
      console.log(`Updated ruleset '${body.name}' (id: ${existing.id}) on ${OWNER}/${REPO}`)
    } else {
      yield* createRuleset(body)
      console.log(`Created ruleset '${body.name}' on ${OWNER}/${REPO}`)
    }
  }),
).pipe(Cli.Command.withDescription('Create or update repository ruleset from generated repo-settings file'))

const showRulesetsCommand = Cli.Command.make(
  'show',
  {
    branch: Cli.Options.choice('branch', ['dev', 'main'] as const).pipe(
      Cli.Options.withDescription('Ruleset variant to show'),
      Cli.Options.withDefault('dev'),
    ),
  },
  Effect.fn(function* ({ branch }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody(branch)
    const existing = yield* getRulesetByName(body.name)

    if (!existing) {
      console.log(`No ruleset found with name '${body.name}'`)
      console.log(`Run 'mono github rulesets sync --branch ${branch}' to create one.`)
      return
    }

    console.log(`Ruleset: ${existing.name}`)
    console.log(`ID: ${existing.id}`)
    console.log(`Enforcement: ${existing.enforcement}`)

    const details = yield* cmdText(['gh', 'api', `repos/${OWNER}/${REPO}/rulesets/${existing.id}`, '--jq', '.'], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    console.log('\nFull details:')
    const parsed = yield* Schema.decode(Schema.parseJson(Schema.Unknown))(details)
    console.dir(parsed, { depth: null })
  }),
).pipe(Cli.Command.withDescription('Show current ruleset configuration'))

export const githubCommand = Cli.Command.make('github').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('rulesets').pipe(
      Cli.Command.withDescription('Manage repository rulesets from generated repo-settings files'),
      Cli.Command.withSubcommands([syncRulesetsCommand, showRulesetsCommand]),
    ),
  ]),
)
