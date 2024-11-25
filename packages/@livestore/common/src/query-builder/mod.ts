export * from './api.js'
export * from './impl.js'

/**
 * Design decisions:
 *
 * - Close abstraction to SQLite to provide a simple & convenient API with predictable behaviour
 * - Use table schema definitions to parse, map & validate query results
 * - Implementation detail: Separate type-level & AST-based runtime implementation
 */
