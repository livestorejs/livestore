---
"@livestore/common-cf": patch
---

Scope DO-RPC binary parsers per request/response so concurrent stream and unary decodes cannot share incomplete frame state.
