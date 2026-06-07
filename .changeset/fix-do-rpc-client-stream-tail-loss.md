---
"@livestore/common-cf": patch
---

Scope DO-RPC msgpack parsers per request/response so concurrent stream and unary decodes cannot share incomplete frame state.
