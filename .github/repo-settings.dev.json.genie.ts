import { requiredCIJobs } from '../genie/ci.ts'
import { githubRuleset } from '../repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

export default githubRuleset({
  name: 'dev-branch-rules',
  enforcement: 'active',
  target: 'branch',
  conditions: {
    ref_name: {
      include: ['refs/heads/dev'],
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
        required_status_checks: requiredCIJobs.map((context) => ({ context })),
      },
    },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
  ],
  bypass_actors: [
    {
      actor_id: 5,
      actor_type: 'RepositoryRole',
      bypass_mode: 'always',
    },
  ],
})
