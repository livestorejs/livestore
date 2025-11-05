import path from 'node:path'

import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'
import YAML from 'yaml'

/**
 * GitHub branch protection updater for required status checks.
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
 * - Idempotent: clears existing required checks first, then sets the precise, desired set.
 */
const OWNER = 'livestorejs'
const REPO = 'livestore'
/** Flagged on jobs in the workflow YAML to mark them as branch protection required. */
const BRANCH_PROTECTION_ENV_KEY = 'LIVESTORE_BRANCH_PROTECTION_REQUIRED'

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
    .sort(([a], [b]) => a.localeCompare(b))
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

    return Array.from(contexts).sort((a, b) => a.localeCompare(b))
  })

const getCurrentRequiredContexts = (branch: string) =>
  Effect.gen(function* () {
    const response = yield* cmdText(
      ['gh', 'api', `repos/${OWNER}/${REPO}/branches/${branch}/protection`, '--jq', '.'],
      { stderr: 'pipe' },
    )

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
    )
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
    )
  })

/**
 * Subcommand to update the required checks for a protected branch.
 * Uses the GitHub CLI and applies an idempotent, two-step update (clear → set).
 */
const updateBranchProtectionCommand = Cli.Command.make(
  'update',
  {
    branch: Cli.Options.text('branch').pipe(Cli.Options.withDefault('main')),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ branch, dryRun }) {
    // Preflight: GH CLI installed
    yield* cmdText('gh --version', { stderr: 'pipe' })

    const contexts = yield* computeRequiredContextsFromWorkflow(
      path.join(process.env.WORKSPACE_ROOT ?? '.', '.github', 'workflows', 'ci.yml'),
    )

    const existing = yield* getCurrentRequiredContexts(branch)

    if (dryRun) {
      const desiredSet = new Set(contexts)
      const existingSet = new Set(existing)
      const toRemove = existing.filter((context) => !desiredSet.has(context)).sort((a, b) => a.localeCompare(b))
      const toAdd = contexts.filter((context) => !existingSet.has(context)).sort((a, b) => a.localeCompare(b))

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

export const githubCommand = Cli.Command.make('github').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('branch-protection').pipe(Cli.Command.withSubcommands([updateBranchProtectionCommand])),
  ]),
)
