import path from 'node:path'

import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

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

const getRulesetFilePath = () => path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'repo-settings.json')

const loadRulesetBody = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const filePath = getRulesetFilePath()
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
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ dryRun }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const body = yield* loadRulesetBody()
    const existing = yield* getRulesetByName(body.name)

    if (dryRun === true) {
      console.log(`Ruleset file: ${getRulesetFilePath()}`)
      console.log(`Ruleset name: ${body.name}`)
      console.log(`Existing: ${existing !== null ? `yes (id: ${existing.id})` : 'no'}`)
      console.log(`Action: ${existing !== null ? 'update' : 'create'}`)
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
