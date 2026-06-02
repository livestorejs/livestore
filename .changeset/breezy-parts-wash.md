---
---

No release impact. CI-only: emit `WORKFLOW_REPORT_V1` records from the snapshot publish, docs deploy, and examples deploy jobs and aggregate them into a single managed PR comment via the effect-utils workflow-reporting framework (effect-utils#724). Contributors can now grab the snapshot install command, DevTools Chrome ZIP link, docs preview URL, and per-example Cloudflare Worker preview URLs from one comment instead of digging through workflow logs.
