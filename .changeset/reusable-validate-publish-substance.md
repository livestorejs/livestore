---
---

No release impact. Extracts a reusable `validate-publish-substance.yml` workflow that both `ci.yml` (snapshot rehearsal) and `release.yml` (stable validation) call via `workflow_call`. Models cross-job state (`release-version`, `npm-tag`, `deploy-target`) as typed workflow outputs instead of `$GITHUB_ENV` writes, making the bug class behind livestorejs/livestore#1278 (env vars silently not carrying across jobs) unrepresentable. Stacks on overengineeringstudio/effect-utils#735, which adds a `JobWithUses` variant to the genie github-workflow runtime so `uses:` reusable-workflow jobs can be expressed with full type-checking.
