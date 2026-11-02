import { prReviewsPullRequestRule } from '#mr/effect-utils/genie/ci-workflow.ts'

import { requiredCIJobs } from '../genie/ci.ts'
import { githubRuleset } from '../genie/repo.ts'

export default githubRuleset({
  name: 'main-branch-rules',
  enforcement: 'active',
  target: 'branch',
  conditions: {
    ref_name: {
      include: ['refs/heads/main'],
      exclude: [],
    },
  },
  rules: [
    {
      type: 'pull_request',
      parameters: {
        ...prReviewsPullRequestRule({
          dismissStaleReviewsOnPush: false,
          requireCodeOwnerReview: true,
        }).parameters,
        require_extra_approval_for_unattributed_changes: true,
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: requiredCIJobs.map((context) => ({ context })),
      },
    },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
  ],
  bypass_actors: [],
})
