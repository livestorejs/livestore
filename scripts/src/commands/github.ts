import path from 'node:path'

import YAML from 'yaml'

import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

/**
 * GitHub branch protection and rulesets management.
 *
 * Why this exists:
 * - GitHub branch protection requires an explicit, static list of required check contexts.
 * - Our CI evolves (matrix expansions, renamed jobs), which easily drifts from the protected list.
 * - This command computes the exact contexts from the workflow definition and applies them via
 *   the GitHub CLI, keeping protection in lockstep with CI.
 *
 * Key properties:
 * - Deterministic and branch-agnostic: reads `.github/workflows/ci.yml` instead of inspecting runs.
 * - Single source of truth: parses the workflow jobs (including matrix axes) directly from YAML.
 * - Idempotent: clears existing checks first, then sets the precise, desired set.
 *
 * Rulesets vs Branch Protection:
 * - Rulesets are newer and support bypass actors that work with auto-merge.
 * - Branch protection bypass only works for manual merges, not auto-merge.
 * - Use `mono github rulesets update` for the newer ruleset-based approach.
 */
const OWNER = 'livestorejs'
const REPO = 'livestore'
/** Flagged on jobs in the workflow YAML to mark them as branch protection required. */
const BRANCH_PROTECTION_ENV_KEY = 'LIVESTORE_BRANCH_PROTECTION_REQUIRED'
/** GitHub Actions app ID for status checks. */
const GITHUB_ACTIONS_APP_ID = 15368
/** User ID for schickling (main maintainer with bypass permissions). */
const _MAINTAINER_USER_ID = 1567498
const MAINTAINER_USERNAME = 'schickling'

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input)

type TMatrixCombination = Record<string, unknown>

const formatMatrixValue = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const createCombinationKey = (combo: TMatrixCombination): string => {
  const entries = Object.entries(combo)
    .filter(([key]) => key !== 'name')
    .toSorted(([a], [b]) => a.localeCompare(b))
  return entries.map(([key, value]) => `${key}=${formatMatrixValue(value)}`).join('|')
}

const matchesExclusion = (combo: TMatrixCombination, candidate: Record<string, unknown>): boolean => {
  const entries = Object.entries(candidate)
  if (entries.length === 0) return false
  for (const [key, value] of entries) {
    if (key === 'name') continue
    if (!Object.hasOwn(combo, key)) return false
    if (formatMatrixValue(combo[key]) !== formatMatrixValue(value)) return false
  }
  return true
}

const expandMatrix = (
  matrix: unknown,
): { combinations: ReadonlyArray<TMatrixCombination>; axisOrder: ReadonlyArray<string> } => {
  if (!isRecord(matrix)) return { combinations: [], axisOrder: [] }

  const axisEntries = Object.entries(matrix).filter(([, value]) => Array.isArray(value))
  const axisOrder = axisEntries.map(([key]) => key)

  let combinations: TMatrixCombination[] = [{}]

  for (const [axis, values] of axisEntries) {
    if (!Array.isArray(values) || values.length === 0) continue
    const next: TMatrixCombination[] = []
    for (const combo of combinations) {
      for (const value of values) {
        next.push({ ...combo, [axis]: value })
      }
    }
    combinations = next.length > 0 ? next : combinations
  }

  if (axisOrder.length === 0 && combinations.length === 0) {
    combinations = [{}]
  }

  const includes = Array.isArray(matrix.include) ? (matrix.include as Array<unknown>).filter(isRecord) : []

  const excludes = Array.isArray(matrix.exclude) ? (matrix.exclude as Array<unknown>).filter(isRecord) : []

  const combined = [...combinations, ...includes]

  const seen = new Set<string>()
  const result: TMatrixCombination[] = []

  for (const combo of combined) {
    if (excludes.some((candidate) => matchesExclusion(combo, candidate))) {
      continue
    }

    const key = createCombinationKey(combo)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(combo)
  }

  return { combinations: result, axisOrder }
}

const formatJobContext = (jobName: string, combo: TMatrixCombination, axisOrder: ReadonlyArray<string>): string => {
  const orderedKeys: string[] = []
  for (const key of axisOrder) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key)
  }
  for (const key of Object.keys(combo)) {
    if (key === 'name') continue
    if (!orderedKeys.includes(key)) orderedKeys.push(key)
  }

  const values = orderedKeys
    .map((key) => combo[key])
    .filter((value) => value !== undefined)
    .map((value) => formatMatrixValue(value))
    .filter((value) => value.length > 0)

  if (values.length === 0) return jobName
  return `${jobName} (${values.join(', ')})`
}

/**
 * Build the list of required contexts from the workflow definition and registry.
 * Keeps the protected checks aligned with CI without querying run history.
 */
const computeRequiredContextsFromWorkflow = (workflowPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString(workflowPath)
    const doc = YAML.parse(raw)

    if (!isRecord(doc)) {
      return []
    }

    const jobsNode = doc.jobs
    if (!isRecord(jobsNode)) {
      return []
    }

    const contexts = new Set<string>()

    for (const [jobId, jobValue] of Object.entries(jobsNode)) {
      if (!isRecord(jobValue)) continue

      const envNode = jobValue.env
      const isProtected =
        (isRecord(envNode) && String(envNode[BRANCH_PROTECTION_ENV_KEY]).toLowerCase() === 'true') || false
      if (!isProtected) continue

      const rawName = jobValue.name
      const jobName = typeof rawName === 'string' && !rawName.includes('${{') && rawName.trim() !== '' ? rawName : jobId

      const strategy = jobValue.strategy
      if (isRecord(strategy) && Object.hasOwn(strategy, 'matrix')) {
        const { combinations, axisOrder } = expandMatrix(strategy.matrix)

        if (combinations.length === 0) {
          contexts.add(jobName)
        } else {
          for (const combo of combinations) {
            contexts.add(formatJobContext(jobName, combo, axisOrder))
          }
        }
        continue
      }

      contexts.add(jobName)
    }

    return Array.from(contexts).toSorted((a, b) => a.localeCompare(b))
  })

const getCurrentRequiredContexts = (branch: string) =>
  Effect.gen(function* () {
    const response = yield* cmdText(
      ['gh', 'api', `repos/${OWNER}/${REPO}/branches/${branch}/protection`, '--jq', '.'],
      { stderr: 'pipe' },
    ).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const parsed = JSON.parse(response) as { required_status_checks?: { contexts?: string[] } } | null
    const current = parsed?.required_status_checks?.contexts ?? []
    return Array.isArray(current) ? current : []
  })

const getStrictFlag = (branch: string) =>
  Effect.gen(function* () {
    const out = yield* cmdText(
      [
        'gh',
        'api',
        `repos/${OWNER}/${REPO}/branches/${branch}/protection`,
        '--jq',
        '.required_status_checks.strict // true',
      ],
      { stderr: 'pipe' },
    ).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
    return out.trim() === 'true'
  })

const patchRequiredChecks = ({ branch, contexts, strict }: { branch: string; contexts: string[]; strict: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = path.join(process.env.WORKSPACE_ROOT ?? '.', 'tmp', 'gh-branch-protection')
    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const bodyPath = path.join(tmpDir, 'body.json')
    const body = yield* Schema.encode(
      Schema.parseJson(Schema.Struct({ strict: Schema.Boolean, contexts: Schema.Array(Schema.String) })),
    )({ strict, contexts })

    yield* fs.writeFileString(bodyPath, body)

    yield* cmd(
      [
        'gh',
        'api',
        '-X',
        'PATCH',
        `repos/${OWNER}/${REPO}/branches/${branch}/protection/required_status_checks`,
        '-H',
        'content-type: application/json',
        '--input',
        bodyPath,
      ],
      { stderr: 'pipe' },
    ).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  })

/**
 * Subcommand to update the required checks for a protected branch.
 * Uses the GitHub CLI and applies an idempotent, two-step update (clear → set).
 */
const updateBranchProtectionCommand = Cli.Command.make(
  'update',
  {
    branch: Cli.Options.text('branch').pipe(
      Cli.Options.withDescription('Target branch to update (dev is the main PR target, main is for releases)'),
      Cli.Options.withDefault('dev'),
    ),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ branch, dryRun }) {
    // Preflight: GH CLI installed
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const contexts = yield* computeRequiredContextsFromWorkflow(
      path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'workflows', 'ci.yml'),
    )

    const existing = yield* getCurrentRequiredContexts(branch)

    if (dryRun) {
      const desiredSet = new Set(contexts)
      const existingSet = new Set(existing)
      const toRemove = existing.filter((context) => !desiredSet.has(context)).toSorted((a, b) => a.localeCompare(b))
      const toAdd = contexts.filter((context) => !existingSet.has(context)).toSorted((a, b) => a.localeCompare(b))

      if (toRemove.length > 0) {
        console.log('Would remove:')
        for (const context of toRemove) console.log(`- ${context}`)
      } else {
        console.log('Would remove: (none)')
      }

      if (toAdd.length > 0) {
        console.log('Would add:')
        for (const context of toAdd) console.log(`- ${context}`)
      } else {
        console.log('Would add: (none)')
      }

      console.log('Would set required checks to:')
      for (const c of contexts) console.log(`- ${c}`)
      return
    }

    const strict = yield* getStrictFlag(branch)

    // Idempotent: clear first, then set exact list
    yield* patchRequiredChecks({ branch, contexts: [], strict })
    yield* patchRequiredChecks({ branch, contexts, strict })

    console.log(`Updated required status checks on ${OWNER}/${REPO}@${branch}`)
  }),
).pipe(Cli.Command.withDescription('Update branch protection required status checks'))

// ============================================================================
// Rulesets Management
// ============================================================================

/**
 * Schema for the ruleset API request body.
 *
 * References:
 * - GitHub API: https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset
 * - Terraform provider (verified against): https://github.com/integrations/terraform-provider-github/blob/main/github/resource_github_repository_ruleset.go
 *
 * Actor types and IDs (from Terraform validation):
 * - RepositoryRole: 1=Read, 2=Triage, 3=Write, 4=Maintain, 5=Admin
 * - OrganizationAdmin: use actor_id=1
 * - Team/Integration: use the actual team_id or app_id
 */
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

    const rulesets = JSON.parse(response) as TExistingRuleset[]
    return rulesets.find((r) => r.name === name) ?? null
  })

const createRuleset = (body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = path.join(process.env.WORKSPACE_ROOT ?? '.', 'tmp', 'gh-rulesets')
    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const bodyPath = path.join(tmpDir, 'ruleset-body.json')
    const bodyJson = yield* Schema.encode(Schema.parseJson(RulesetRequestBody))(body)
    yield* fs.writeFileString(bodyPath, bodyJson)

    yield* cmd(['gh', 'api', '-X', 'POST', `repos/${OWNER}/${REPO}/rulesets`, '--input', bodyPath], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  })

const updateRuleset = (rulesetId: number, body: TRulesetRequestBody) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = path.join(process.env.WORKSPACE_ROOT ?? '.', 'tmp', 'gh-rulesets')
    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const bodyPath = path.join(tmpDir, 'ruleset-body.json')
    const bodyJson = yield* Schema.encode(Schema.parseJson(RulesetRequestBody))(body)
    yield* fs.writeFileString(bodyPath, bodyJson)

    yield* cmd(['gh', 'api', '-X', 'PUT', `repos/${OWNER}/${REPO}/rulesets/${rulesetId}`, '--input', bodyPath], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  })

const buildRulesetBody = (branch: string, contexts: string[]): TRulesetRequestBody => ({
  name: `${branch}-branch-rules`,
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [
    {
      /** RepositoryRole actor_id 5 = Admin role */
      actor_id: 5,
      actor_type: 'RepositoryRole',
      bypass_mode: 'always',
    },
  ],
  conditions: {
    ref_name: {
      include: [`refs/heads/${branch}`],
      exclude: [],
    },
  },
  rules: [
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: contexts.map((context) => ({
          context,
          integration_id: GITHUB_ACTIONS_APP_ID,
        })),
      },
    },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
  ],
})

/**
 * Subcommand to update rulesets for a branch.
 * Rulesets are the newer alternative to branch protection with better bypass support for auto-merge.
 */
const updateRulesetsCommand = Cli.Command.make(
  'update',
  {
    branch: Cli.Options.text('branch').pipe(
      Cli.Options.withDescription('Target branch to update (dev is the main PR target, main is for releases)'),
      Cli.Options.withDefault('dev'),
    ),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ branch, dryRun }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const contexts = yield* computeRequiredContextsFromWorkflow(
      path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'workflows', 'ci.yml'),
    )

    const rulesetName = `${branch}-branch-rules`
    const existing = yield* getRulesetByName(rulesetName)
    const body = buildRulesetBody(branch, contexts)

    if (dryRun) {
      console.log(`Ruleset name: ${rulesetName}`)
      console.log(`Existing: ${existing ? `yes (id: ${existing.id})` : 'no'}`)
      console.log(`Action: ${existing ? 'update' : 'create'}`)
      console.log(`\nBypass actors:`)
      console.log(`- Repository Admins (actor_id: 5, bypass_mode: always)`)
      console.log(`\nRequired status checks (${contexts.length}):`)
      for (const c of contexts) console.log(`- ${c}`)
      console.log(`\nPull request rules:`)
      console.log(`- required_approving_review_count: 1`)
      console.log(`- required_review_thread_resolution: true`)
      console.log(`\nOther rules:`)
      console.log(`- non_fast_forward`)
      console.log(`- deletion`)
      return
    }

    if (existing) {
      yield* updateRuleset(existing.id, body)
      console.log(`Updated ruleset '${rulesetName}' (id: ${existing.id}) on ${OWNER}/${REPO}`)
    } else {
      yield* createRuleset(body)
      console.log(`Created ruleset '${rulesetName}' on ${OWNER}/${REPO}`)
    }

    console.log(`\nNote: To use rulesets, you should disable the corresponding branch protection rule.`)
    console.log(`The ruleset bypass allows ${MAINTAINER_USERNAME} to auto-merge PRs without waiting for reviews.`)
  }),
).pipe(Cli.Command.withDescription('Create or update repository rulesets (recommended over branch protection)'))

/**
 * Subcommand to show current ruleset status.
 */
const showRulesetsCommand = Cli.Command.make(
  'show',
  {
    branch: Cli.Options.text('branch').pipe(
      Cli.Options.withDescription('Target branch to show rulesets for'),
      Cli.Options.withDefault('dev'),
    ),
  },
  Effect.fn(function* ({ branch }) {
    yield* cmdText('gh --version', { stderr: 'pipe' }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    const rulesetName = `${branch}-branch-rules`
    const existing = yield* getRulesetByName(rulesetName)

    if (!existing) {
      console.log(`No ruleset found with name '${rulesetName}'`)
      console.log(`Run 'mono github rulesets update --branch ${branch}' to create one.`)
      return
    }

    console.log(`Ruleset: ${existing.name}`)
    console.log(`ID: ${existing.id}`)
    console.log(`Enforcement: ${existing.enforcement}`)

    const details = yield* cmdText(['gh', 'api', `repos/${OWNER}/${REPO}/rulesets/${existing.id}`, '--jq', '.'], {
      stderr: 'pipe',
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))

    console.log(`\nFull details:`)
    console.log(JSON.stringify(JSON.parse(details), null, 2))
  }),
).pipe(Cli.Command.withDescription('Show current ruleset configuration'))

export const githubCommand = Cli.Command.make('github').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('branch-protection').pipe(Cli.Command.withSubcommands([updateBranchProtectionCommand])),
    Cli.Command.make('rulesets').pipe(
      Cli.Command.withDescription('Manage repository rulesets (recommended over branch protection)'),
      Cli.Command.withSubcommands([updateRulesetsCommand, showRulesetsCommand]),
    ),
  ]),
)
