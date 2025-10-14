# Plan

1. Capture issue reproduction by adding a targeted unit test that defines the reported schemas and triggers `shapes.insert(...).asSql()` to observe the parse error.
2. Use the failing test to inspect generated `insertSchema` and runtime error message for insight.
3. Trace schema conversion logic (especially `schemaFieldsToColumns` and `Schema.parseJson` usage) to identify why the discriminant literal is narrowed incorrectly.
4. Document root cause analysis and outline potential fix approach in repository notes without implementing fix (since task only requires proposal).
