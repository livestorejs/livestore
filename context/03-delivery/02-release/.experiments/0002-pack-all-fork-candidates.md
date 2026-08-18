# 0002 — Package candidates for every fork PR head

Date: 2026-08-18

## Question

Is it simpler and safe enough to package an immutable snapshot candidate for
every fork PR update in ordinary CI, while using a persistent maintainer label
only as the trusted publication gate?

## Method

- Re-read PR #1558, CI run `32037941002`, its jobs, and artifacts through the
  GitHub API without mutating the PR or workflow.
- Exercised candidate selection and live-label/head authorization with a local
  state model, including label removal, head changes, closed PRs, and run
  attempts.
- Ran `node --test .github/scripts/pr-snapshot-artifact.test.mjs` against the
  untrusted artifact boundary.
- Compared the concrete generated-workflow surfaces required by unconditional
  fork packaging and a dedicated label-triggered packaging workflow.
- Measured a successful repository-owned snapshot pack run as a proxy for the
  incremental compute cost.
- Checked GitHub's official fork-token, rerun, cache, `pull_request_target`, and
  `workflow_run` security contracts.

## Result

Verdict: **PARTIAL**. The local and live read-only seams support the design, but
no disposable hosted fork candidate was created, so upload through trusted
validation remains unproven end to end.

Evidence established:

- Fork `pull_request` packaging has a read-only token and no secrets. The job
  further narrows permissions to `contents: read` and clears `CACHIX_AUTH_TOKEN`.
- PR #1558's successful fork run has `pull_requests: []`; the commit-to-PR API
  also returns no association. Trusted resolution must match the exact tuple
  `(head repository, head branch, head SHA)` to one open PR, then re-read it.
- The existing artifact validator passed 11/11 adversarial tests. It rejects
  digest and identity drift, unexpected files, traversal, lifecycle scripts,
  `.npmrc`, hostile `publishConfig`, oversized archives, and topology drift.
- State enumeration confirmed that a changed head invalidates the old
  candidate, label removal denies queued publication, and a labeled current
  head with a matching candidate is eligible.
- A representative successful pack job took 20m50s; its pack step took 17m34s
  and produced a 4,282,985-byte artifact. Unconditional packaging pays roughly
  this runner cost for every fork update, labeled or not.
- Applying the label cannot backfill PR #1558's old run: its pack job was
  skipped and no candidate exists. GitHub reruns preserve the original SHA/ref
  and do not provide a reliable new-workflow backfill.

Implementation-surface comparison:

| Surface | Package every fork | Dedicated labeled packaging |
| --- | --- | --- |
| Packaging trigger | Broaden existing CI job | Add one small workflow |
| Fork identity resolution | Required | Required |
| Label authorization | Required | Required |
| Trusted artifact validation | Required | Required |
| Final revocation/head recheck | Required | Required |
| Unlabeled fork compute | Every update | None |
| Existing-PR label backfill | No | Yes |

## Conclusion

Packaging every fork is defensible and removes one workflow trigger, but it is
not dramatically simpler: almost all trusted identity, authorization,
validation, scheduling, and revocation changes remain. Its distinct tradeoffs
are approximately 21 runner-minutes per fork update and no automatic backfill
for pre-feature runs such as #1558.

A hosted disposable fork test must prove candidate upload, exact tuple
resolution, trusted validation, and final label/head denial before this option
receives a full PASS.

## VRS Impact

If adopted, the release contract should state that candidate production is
unprivileged and unconditional for fork PR heads, while publication authority
is the live maintainer-applied label on the current PR head ref. It must not use
Actions `pull_requests` or commit associations as the fork identity source.
The runbook should disclose that labeling a PR whose earlier run predates the
feature may require a new PR event before a candidate exists.
