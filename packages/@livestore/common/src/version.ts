// TODO bring back when Expo and Playwright supports `with` imports
// import packageJson from '../package.json' with { type: 'json' }
// export const liveStoreVersion = packageJson.version

export const liveStoreVersion = '0.4.0-dev.12' as const

/**
 * This version number is incremented whenever the internal storage format changes in a breaking way.
 * Whenever this version changes, LiveStore will start with fresh database files. Old database files are not deleted.
 *
 * While LiveStore is in beta, this might happen more frequently.
 * In the future, LiveStore will provide a migration path for older database files to avoid the impression of data loss.
 */
export const liveStoreStorageFormatVersion = 6
