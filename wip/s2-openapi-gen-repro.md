# Repro: @tim-smart/openapi-gen with S2 OpenAPI

Goal: Generate an Effect HttpClient for S2 using https://github.com/tim-smart/openapi-gen and S2’s OpenAPI spec.

## Environment

- Node: output of `node -v` during run was v24.5.0
- pnpm: project uses pnpm 10.x
- openapi-gen: invoked via `pnpm dlx @tim-smart/openapi-gen`
- Spec: https://raw.githubusercontent.com/s2-streamstore/s2-protos/refs/heads/main/s2/v1/openapi.json (OpenAPI 3.1)

## Steps to Reproduce

1) Fetch spec

- Saved to `packages/@livestore/sync-s2/openapi.s2.json`

```
curl -fsSL https://raw.githubusercontent.com/s2-streamstore/s2-protos/refs/heads/main/s2/v1/openapi.json \
  -o packages/@livestore/sync-s2/openapi.s2.json
```

2) Run generator

```
pnpm dlx @tim-smart/openapi-gen -s packages/@livestore/sync-s2/openapi.s2.json -n S2Client > /tmp/out.ts
```

3) Observed error

```
[ERROR]: TypeError: Cannot use 'in' operator to search for 'type' in false
    at cleanupSchema .../node_modules/@tim-smart/openapi-gen/main.js:34827:16
    at toSource .../main.js:34976:14
    (stack continues)
```

The error occurs even with `-t` (type-only) flag:

```
pnpm dlx @tim-smart/openapi-gen -s packages/@livestore/sync-s2/openapi.s2.json -n S2Client -t
# Same error
```

4) Investigating spec incompatibilities

- The S2 OpenAPI includes places where `"items": false` appears under schema definitions (OpenAPI 3.1 allows `false` as a valid JSON Schema to mean “never”).
- The generator throws when encountering `false` where it expects a schema object.

We tried sanitizing the spec (replacing `"items": false` with `"items": {}`) and re-running the generator; additional adjustments may be needed.

## Expected

- Generator should produce a client (or gracefully skip unsupported constructs) for valid OpenAPI 3.1 specs that use JSON Schema `false`.

## Workarounds

- Preprocess the spec to replace `false` schemas with `{}` for fields like `items`.
- Alternatively, constrain to OpenAPI 3.0-style schemas.

## Suggested next steps

- Add handling for JSON Schema boolean form (`true`/`false`) in `cleanupSchema`.
- Provide an option flag to coerce boolean schemas to permissive/empty schema nodes.

## Context

- We’re integrating S2 as a sync provider for LiveStore. We will continue using handcrafted HTTP client code for now and revisit generation once the tool supports S2’s spec.

