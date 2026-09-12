# 0002 — Track state-file ownership before cleanup

Status: accepted (2026-09-06), implemented in PR #1615.

## Context

Obsolete state files consume DO storage. Filename prefixes and even exact hash
formats do not establish ownership of files in the shared VFS table.

## Decision

Record the exact path in `__livestore_state_files` before the adapter opens a
state database. After successful boot, delete other registered files and their
records in one native storage transaction. Keep registration and cleanup in the
adapter's `state-files.ts` module. Do not infer ownership from filenames.

## Consequences

Registration adds one metadata row per selected state file, with no row writes
when reopening an already registered file. Failed boots leave tracked files for
later cleanup, and failed cleanup preserves the records needed to retry.

Historical unregistered orphans remain untouched. An existing state file becomes
tracked when opened normally. This avoids inspecting arbitrary databases or
maintaining parsers for old hash formats. Cleanup consumes write quota and runs
after boot, so storage-full recovery remains outside this change.

## Evidence

Cloudflare integration regressions cover unrelated files with valid state names,
adoption of existing state without replay, registration failure before file
creation, failed rebuilds, atomic page/registry cleanup retry, and zero-write
completed-state reopening.
