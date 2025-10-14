# Problem Statement

- **Issue**: Discriminated union schema fails to parse for insert despite schema discriminant value matching inserted data when using `Schema.transform` JSON conversion for nested struct.
- **Context**: Reported in https://github.com/livestorejs/livestore/issues/470#issuecomment-3402372144 while using `@livestore/state` with SQLite table schema and materializers on `v0.4.0-dev.10`.
- **Expected Behavior**: Inserting a row via `shapes.insert({ kind: "square", data: { sideLength: 10 } })` should succeed, matching the discriminated union schema.
- **Actual Behavior**: `ParseError` complaining `Expected "circle", actual "square"` on the `kind` field. Removing discriminant or using `attachPropertySignature` leads to missing `kind` in insert signature and other errors.
- **Reproduction**: Using example from Effect schema docs with `Schema.Union` of `CircleSchema` and `SquareSchema` where nested `data` struct is wrapped with a JSON string transform. Locally reproduced via Vitest (`pnpm vitest run packages/@livestore/common/src/schema/state/sqlite/table-def.test.ts`).
