/**
 * Manual-only preparation for matched Namespace sizing trials. Dispatch remains
 * blocked operationally until sponsorship and dedicated profiles are verified.
 * Derive the checks from CI so setup, retries, cache behavior and coverage stay
 * identical. Changeset-check is excluded: workflow_dispatch has no github.base_ref
 * or authentic PR comparison context, and substituting main would change scope.
 */
import type { GitHubWorkflowArgs } from '#mr/effect-utils/genie/external.ts'

import { defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'
import ci from './ci.yml.genie.ts'

const benchmarkCommit = 'a52baaff0396dfc4ac8ca7e295afdd4fab051cf8'
const lanes = ['source-policy', 'lint', 'type-check'] as const
const baselineProfile = 'namespace-profile-livestore-benchmark-linux-baseline'
const candidateProfile = 'namespace-profile-livestore-benchmark-linux-candidate'
type WorkflowStep = GitHubWorkflowArgs['jobs'][string]['steps'][number]

const isWorkflowStep = (step: unknown): step is WorkflowStep =>
  typeof step === 'object' &&
  step !== null &&
  (('run' in step && typeof step.run === 'string') || ('uses' in step && typeof step.uses === 'string'))

/** Preserve every original step; the subject checkout is the only replacement. */
const pinCheckout = (step: unknown): WorkflowStep[] => {
  if (isWorkflowStep(step) === false) throw new Error('Unexpected CI step shape')
  if ('uses' in step === false || step.uses.startsWith('actions/checkout@') === false) return [step]
  return [
    { ...step, with: { ...step.with, ref: '${{ inputs.benchmark_commit }}' } },
    {
      name: 'Verify exact benchmark checkout',
      ...(step.if === undefined ? {} : { if: step.if }),
      env: { BENCHMARK_COMMIT: '${{ inputs.benchmark_commit }}' },
      run: 'test "$(git rev-parse HEAD)" = "$BENCHMARK_COMMIT"',
    },
  ]
}

const inputGuard: WorkflowStep = {
  name: 'Validate pinned benchmark inputs',
  env: {
    BENCHMARK_COMMIT: '${{ inputs.benchmark_commit }}',
    BENCHMARK_PAIR_ID: '${{ inputs.pair_id }}',
    BENCHMARK_CACHE_STATE: '${{ inputs.cache_state }}',
    BENCHMARK_PROFILE: '${{ inputs.profile }}',
  },
  run: [
    'set -euo pipefail',
    `test "$BENCHMARK_COMMIT" = '${benchmarkCommit}'`,
    '[[ "$BENCHMARK_PAIR_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$ ]] || exit 1',
    'case "$BENCHMARK_PROFILE" in baseline|candidate) ;; *) exit 1 ;; esac',
    'case "$BENCHMARK_CACHE_STATE" in warm|cold) ;; *) exit 1 ;; esac',
  ].join('\n'),
}

const jobs = Object.fromEntries(
  lanes.map((lane) => {
    const original = ci.data.jobs[lane]
    return [
      lane,
      {
        ...original,
        if: `inputs.lane == '${lane}'`,
        'runs-on': [
          `\${{ inputs.profile == 'baseline' && '${baselineProfile}' || '${candidateProfile}' }}`,
          'namespace-features:github.run-id=${{ github.run_id }}',
        ],
        steps: [inputGuard, ...original.steps.flatMap(pinCheckout)],
      },
    ]
  }),
)

export default githubWorkflow({
  name: 'Namespace sizing benchmark',
  'run-name': 'Namespace sizing: ${{ inputs.lane }} / ${{ inputs.profile }} / ${{ inputs.pair_id }}',
  actionlint: defaultActionlintConfig,
  on: {
    workflow_dispatch: {
      inputs: {
        benchmark_commit: {
          description: 'Exact supported subject SHA',
          type: 'string',
          required: true,
          default: benchmarkCommit,
        },
        lane: {
          description: 'One unchanged CI lane',
          type: 'choice',
          required: true,
          options: [...lanes],
          default: 'source-policy',
        },
        profile: {
          description: 'Verified dedicated sizing profile',
          type: 'choice',
          required: true,
          options: ['baseline', 'candidate'],
          default: 'baseline',
        },
        pair_id: { description: 'Matched-pair identifier', type: 'string', required: true },
        cache_state: {
          description: 'Operator-verified cache state; does not warm or clear caches',
          type: 'choice',
          required: true,
          options: ['warm', 'cold'],
          default: 'warm',
        },
      },
    },
  },
  // One selected lane at a time; preserve original CI permissions and cache env.
  permissions: ci.data.permissions,
  concurrency: { group: 'namespace-sizing-benchmark', 'cancel-in-progress': false },
  env: {
    ...ci.data.env,
    GITHUB_BRANCH_NAME: benchmarkCommit,
    CI_MEASUREMENT_SUBJECT_REF: '${{ inputs.benchmark_commit }}',
    CI_MEASUREMENT_SUBJECT_SHA: '${{ inputs.benchmark_commit }}',
    CI_MEASUREMENT_SUBJECT_LABEL: '${{ inputs.pair_id }}',
  },
  jobs,
})
