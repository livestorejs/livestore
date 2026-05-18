import pkg from '../package.json' with { type: 'json' }

/**
 * Current LiveStore package version used for display, release assets, and install guidance.
 *
 * Can be overridden at runtime via `globalThis.__LIVESTORE_VERSION_OVERRIDE__` for testing display-only version values.
 */
export const liveStoreVersion: string = (globalThis as any).__LIVESTORE_VERSION_OVERRIDE__ ?? pkg.version

export const devtoolsProtocolVersion: number =
  (globalThis as any).__LIVESTORE_DEVTOOLS_PROTOCOL_VERSION_OVERRIDE__ ?? 1

export const supportedDevtoolsProtocolVersions: ReadonlyArray<number> = [devtoolsProtocolVersion]

export const resolveDevtoolsProtocolVersion = (version: number | undefined): number => version ?? 1

export const isDevtoolsProtocolVersionSupported = (
  version: number | undefined,
  supportedVersions: ReadonlyArray<number> = supportedDevtoolsProtocolVersions,
): boolean => supportedVersions.includes(resolveDevtoolsProtocolVersion(version))

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
