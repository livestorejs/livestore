# Research Notes

## External issue context
- Comment describes failure when using `Schema.transform` to JSON encode nested struct within discriminated union stored in SQLite table via Livestore schema field.
- Error occurs at parse time when inserting `square` variant, complaining discriminant mismatched.

## Initial hypotheses
- `schema` field in table definition may apply JSON serialization differently; perhaps inserted `kind` becomes default from first variant due to transformation interfering with union detection.
- Insert signature appears to widen `kind` to union of literals but lacking discrimination, so parse may rely on runtime `schema` parse result that is inconsistent with encode/decoder used by table operations.

## Next steps
- Create local reproduction using package code with simple test or script.
- Inspect implementation of `State.SQLite.table` and `Schema` handling for `schema` option.
- Trace how insert operations parse and encode values; identify where discriminant comparison occurs.

## Findings
- Added regression coverage in `packages/@livestore/common/src/schema/state/sqlite/table-def.test.ts` that previously reproduced the runtime error; the updated expectation now asserts that both `'circle'` and `'square'` inserts succeed and that the derived column schema retains both literals.
- Root cause is the `stripNullable` helper in `packages/@livestore/common/src/schema/state/sqlite/column-def.ts` which returned only the first union member whenever it encountered a union AST, even when there were no `null`/`undefined` variants. This collapsed discriminated unions to the first branch when deriving column definitions.
- Because `getColumnForSchema` relied on `stripNullable`, the table column schema only accepted `'circle'`. Encoding values during insert therefore rejected `'square'`, producing the reported `ParseError` despite the TypeScript types showing the full union.

## Resolution
- Updated `stripNullable` to filter out only `null`/`undefined` union members, rebuilding the union AST when multiple non-null members remain. This preserves discriminant unions while still unwrapping optional columns.
- Confirmed via the Vitest regression that the SQLite table definition now reports a `'text'` column whose schema string still includes both literals, and that inserts for both union members no longer throw.
