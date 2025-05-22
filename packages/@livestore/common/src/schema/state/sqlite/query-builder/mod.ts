export * from './api.js'
export * from './impl.js'

/**
 * Design decisions:
 *
 * - Close abstraction to SQLite to provide a simple & convenient API with predictable behaviour
 * - Use table schema definitions to parse, map & validate query results
 * - Implementation detail: Separate type-level & AST-based runtime implementation
 *
 * Currently not supported (not exhaustive list):
 * - Assumes a `id` column as primary key
 * - Composite primary keys
 *
 * Other known limitations
 * - Doesn't exclude all invalid query patterns on type level `e.g. `db.todos.returning('id')`
 */
