import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import main from './code-owner-review.json.genie.ts'

export default jsonArtifact({
  data: {
    ...main.data,
    name: 'docs-stable-code-owner-review',
    conditions: { ref_name: { include: ['refs/heads/docs/stable'], exclude: [] } },
    rules: main.data.rules.map((rule) => ({
      ...rule,
      parameters: { ...rule.parameters, allowed_merge_methods: ['merge'] },
    })),
  },
})
