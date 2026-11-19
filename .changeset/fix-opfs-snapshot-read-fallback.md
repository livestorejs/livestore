---
'@livestore/adapter-web': patch
---

Fix store boot failures when concurrent writes invalidate an OPFS snapshot during tab reload by falling back to a leader-provided snapshot.
