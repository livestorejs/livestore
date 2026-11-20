import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

export default jsonArtifact({
  data: {
    name: 'main-code-owner-review',
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
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: true,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          require_extra_approval_for_unattributed_changes: false,
        },
      },
    ],
    bypass_actors: [{ actor_id: 23266928, actor_type: 'User', bypass_mode: 'pull_request' }],
  },
})
