# Changesets

Changesets are the release-intent ledger for public LiveStore packages. The
public `@livestore/*` packages are configured as a fixed group, so one accepted
changeset bumps and publishes the whole LiveStore release group together.

`CHANGELOG.md` remains the curated, user-facing release narrative. Changeset
files record PR-level release intent and semver impact; maintainers fold that
information into `CHANGELOG.md` using the existing changelog guide before a
stable release.

Use an empty changeset for package-affecting changes that do not need release
notes:

```bash
pnpm exec changeset add --empty
```
