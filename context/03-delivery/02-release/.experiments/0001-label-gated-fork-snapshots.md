# 0001 — Label-gated fork snapshot authorization

Date: 2026-08-18

## Question

Can a maintainer-applied pull-request label safely authorize publishing an
exact-head snapshot from a fork without giving fork code secrets or implicitly
authorizing later commits?

## Method

- Inspected the generated CI and release workflows at the branch baseline.
- Queried PR #1558 and its CI run through the GitHub API. The fork CI run had an
  empty `pull_requests` array and its `pack-pr-snapshot` job was skipped.
- Queried recent LiveStore label timeline events. Their `commit_id` fields were
  null, so the issue-event timeline cannot independently bind a label to the PR
  head that was visible when it was applied.
- Compared GitHub's `pull_request` and `pull_request_target` security contracts
  in the official documentation. In particular, `pull_request_target` must not
  check out and execute untrusted fork code.
- Built a pure authorization state model with `Label`, `RemoveLabel`, `Push`,
  and `Publish` actions. A breadth-first driver enumerated all action sequences
  through depth five and checked that every published SHA had its own
  authorization receipt.
- Sketched a two-event workflow and checked its syntax with
  `nix shell nixpkgs#actionlint -c actionlint`.
- Ran the existing artifact-boundary tests with
  `node --test .github/scripts/pr-snapshot-artifact.test.mjs`.

External references:

- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Securely using `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)

## Result

The persistent-label model failed with the shortest witness:

```text
Label(head A) -> Push(head B) -> Publish(head B)
```

The exact-head-receipt model had no invariant violation through depth five.

The viable privilege separation is:

```text
pull_request_target:labeled
  -> trusted workflow records { PR, fork repository, head SHA, actor }

pull_request:labeled
  -> secretless GitHub-hosted runner executes fork packaging
  -> uploads an untrusted immutable candidate

scheduled or dispatched workflow on main
  -> requires matching authorization and candidate identities
  -> re-resolves the open PR and unchanged head
  -> validates bounded tarballs without executing them
  -> publishes through npm trusted publishing
```

The workflow sketch passed `actionlint`. The existing artifact boundary suite
passed 11/11 tests, including digest mutation, identity drift, unexpected
files, traversal paths, and lifecycle-script rejection.

## Conclusion

A label can be the maintainer interaction, but label presence cannot itself be
the durable authorization predicate. The safe design treats the trusted
`labeled` event as a one-shot authorization for the exact PR head SHA and
correlates that receipt with a separately produced untrusted artifact.

`pull_request_target` is suitable only for recording authorization metadata;
it must never check out or execute the fork. Fork packaging belongs in an
unprivileged `pull_request` run. Publication remains in the main-branch trusted
workflow and must recheck the unchanged PR head immediately before npm OIDC.

Open design choices include whether the label replaces review approval for the
authorized SHA, whether repository-owned PRs keep their current automatic path,
and whether the authorization label is removed after receipt creation.

### 2026-08-18 interpretation amendment

The initial oracle treated authorization as exact-head by definition. The
owner subsequently clarified that applying the label deliberately trusts the
contributor-controlled PR head repository and branch, including future commits
while the label remains present. Under that policy, `Label(A) -> Push(B) ->
Publish(B)` is intended behavior rather than a violation. Exact head identity
still binds each candidate and publication, while live label presence grants
eligibility to the current mutable head.

## VRS Impact

This rules out persistent label presence only when the intended grant is
exact-head. Under the clarified mutable-head trust policy, the release spec must
define the label as a revocable grant over the PR head repository and branch,
keep each candidate exact-SHA and fork packaging unprivileged, and require the
trusted publisher to revalidate the current head and live label immediately
before publication. The remaining policy choices are being resolved through
the design interview before normative requirement or spec text changes.
