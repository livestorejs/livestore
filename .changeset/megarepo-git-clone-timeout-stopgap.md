---
---

No release impact. CI-contract change: raise the git subprocess deadline for the "Sync megarepo dependencies" step (`MEGAREPO_GIT_COMMAND_TIMEOUT_MS=600000`) so the cold bare clone of the large `effect` member no longer intermittently hits the pinned megarepo's flat 30s bound on shared CI runners (#1473). Temporary stopgap until effect-utils ships the operation-aware git deadline (overengineeringstudio/effect-utils#965) and is repinned, after which the network default supersedes this override.
