import path from 'node:path'

import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'
import { providerKeys } from '@local/tests-sync-provider/registry'
import YAML from 'yaml'

/**
 * GitHub branch protection updater for required status checks.
 *
 * Why this exists:
 * - GitHub branch protection requires an explicit, static list of required check contexts.
 * - Our CI evolves (matrix expansions, renamed jobs), which easily drifts from the protected list.
 * - This command computes the exact contexts from the workflow and our provider registry and
 *   applies them via the GitHub CLI, keeping protection in lockstep with CI.
 *
 * Key properties:
 * - Deterministic and branch-agnostic: reads `.github/workflows/ci.yml` instead of inspecting runs.
 * - Single source of truth: matrix providers from the test registry; suites from the workflow YAML.
 * - Idempotent: clears existing required checks first, then sets the precise, desired set.
 */
const OWNER = 'livestorejs'
const REPO = 'livestore'

/**
 * Build the list of required contexts from the workflow definition and registry.
 * Keeps the protected checks aligned with CI without querying run history.
 */
const computeRequiredContextsFromWorkflow = (workflowPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString(workflowPath)
    const doc = YAML.parse(raw) as any

    const contexts: string[] = []
    const pushContext = (jobId: string, suffix?: string) => contexts.push(suffix ? `${jobId} (${suffix})` : jobId)

    const jobs: Record<string, any> = doc?.jobs ?? {}

    // Baseline jobs we enforce
    for (const base of ['lint', 'test-unit', 'test-integration-node-sync']) {
      if (jobs[base]) pushContext(base)
    }

    // Sync-provider matrix from registry keys
    if (jobs['test-integration-sync-provider']) {
      for (const key of providerKeys) pushContext('test-integration-sync-provider', key)
    }

    // Playwright matrix suites parsed from workflow YAML
    const pw = jobs['test-integration-playwright']
    const suites: unknown = pw?.strategy?.matrix?.suite
    if (Array.isArray(suites)) {
      for (const s of suites as string[]) pushContext('test-integration-playwright', s)
    } else if (pw) {
      // Fallback if suites are not discoverable
      pushContext('test-integration-playwright')
    }

    for (const additional of ['perf-test', 'wa-sqlite-test', 'check-nix-flake-inputs']) {
      if (jobs[additional]) pushContext(additional)
    }

    return Array.from(new Set(contexts)).sort((a, b) => a.localeCompare(b))
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
    try {
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
    } catch {
      return true
    }
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
