# wa-sqlite Management

> Companion runbook of [03-artifacts](./spec.md) — operational procedure only;
> the normative contract lives in this node's requirements/spec.

wa-sqlite is included as a git subtree (not submodule) at `packages/@livestore/wa-sqlite`.

## Update from upstream

```bash
# Pull latest changes from upstream main branch
git subtree pull --prefix=packages/@livestore/wa-sqlite \
  git@github.com:livestorejs/wa-sqlite.git main --squash
```

## Push changes to fork

```bash
# Push local changes back to the fork
git subtree push --prefix=packages/@livestore/wa-sqlite \
  git@github.com:livestorejs/wa-sqlite.git main
```

## Why subtree?

- No submodule initialization needed
- Changes included in main repo commits
- Simpler for contributors and CI/CD
