// TODO bring back when Expo and Playwright supports `with` imports
// import packageJson from '../package.json' with { type: 'json' }
// export const liveStoreVersion = packageJson.version

export const liveStoreVersion = '0.4.0-dev.14' as const

/**
 * CRITICAL: Increment this version whenever you modify client-side EVENTLOG table schemas.
 *
 * Used to generate database file names (e.g., `eventlog@6.db`, `state@6.db`) across all client adapters.
 *
 * Bump required when:
 * - Modifying eventlog system tables (eventlogMetaTable, syncStatusTable) in schema/state/sqlite/system-tables/eventlog-tables.ts
 * - Changing columns, types, constraints, or indexes in eventlog tables
 *
 * Bump NOT required when:
 * - Modifying STATE table schemas (auto-migrated via hash-based detection and rebuilt from eventlog)
 * - Changing query patterns or client-side implementation details
 *
 * ⚠️  CRITICAL: Eventlog changes without bumping this version cause permanent data loss!
 *
 * Impact: Version changes trigger a "soft reset" - old data becomes inaccessible but remains on disk.
 */
export const liveStoreStorageFormatVersion = 6
