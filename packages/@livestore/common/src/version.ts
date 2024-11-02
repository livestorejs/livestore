import packageJson from '../package.json' with { type: 'json' }
// import packageJson from '../package.json' assert { type: 'json' }

export const liveStoreVersion = packageJson.version

/**
 * This version number is incremented whenever the internal storage format changes in a breaking way.
 * Whenever this version changes, LiveStore will start with fresh database files. Old database files are not deleted.
 *
 * While LiveStore is in alpha, this might happen more frequently.
 * In the future, LiveStore will provide a migration path for older database files to avoid the impression of data loss.
 */
export const liveStoreStorageFormatVersion = 2
