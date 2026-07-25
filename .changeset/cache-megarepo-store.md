---
---

No release impact. CI: cache the megarepo store (bare repos + worktrees) keyed on `megarepo.lock`, so jobs stop cold-cloning the large members (`effect` etc.) from GitHub on every run — the ~700MB-of-bares × ~13-jobs redundant-clone exposure behind #1473 (#1480). On a cache hit `mr apply` sees the pinned commits present and no-ops; the key changes only when a member commit moves. Verified a relocated store re-applies with zero re-clones (git/mr repair moved worktrees).
