---
---

No release impact. Bumps the `effect-utils` pin to pick up the dedicated `@overeng/workflow-report` CLI (effect-utils#733); regenerates the `pr-preview` workflow-report collector step to invoke the upstream Nix-packaged binary instead of inlining the JS runtime, and adds `**/tmp/**` to the shared `.oxfmtrc.json` ignore list.
