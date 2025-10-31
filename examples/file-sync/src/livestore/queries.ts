/**
 * LiveStore Queries - Database queries for file sync operations
 *
 * TODO: Implement database queries for common file sync operations
 * - Query files by directory, modification time, conflict status
 * - Find files needing sync between directories
 * - List all current conflicts with details
 * - Get sync statistics and progress information
 * - Query recent sync activity and events
 */

// TODO: Import schema and query builders
// import { queryDb } from '@livestore/livestore'
// import { state } from './schema.ts'

// TODO: File queries
export const fileQueries = {
  // getAllFiles: () => queryDb(state.files.selectAll()),
  // getFileById: (id: string) =>
  //   queryDb(state.files.select().where({ id })),
  // getFilesNeedingSync: () =>
  //   queryDb(state.files.select()
  //     .where({ conflictState: null })
  //     .where(sql`presentInA != presentInB OR
  //                (presentInA = 1 AND presentInB = 1 AND lastSyncedAt < modifiedAt)`)),
  // getFilesByDirectory: (dir: 'a' | 'b') =>
  //   queryDb(state.files.select()
  //     .where({ [`presentIn${dir.toUpperCase()}`]: true, deletedAt: null })),
}

// TODO: Conflict queries
export const conflictQueries = {
  // getAllConflicts: () => queryDb(state.conflicts.selectAll().where({ resolvedAt: null })),
  // getConflictsByType: (conflictType: string) =>
  //   queryDb(state.conflicts.select().where({ conflictType, resolvedAt: null })),
  // getConflictHistory: (fileId: string) =>
  //   queryDb(state.conflicts.select().where({ fileId }).orderBy('detectedAt', 'desc')),
}

// TODO: Sync status queries
export const syncQueries = {
  // getSyncState: () => queryDb(state.syncState.select()),
  // getSyncStatistics: () => queryDb(sql`
  //   SELECT
  //     COUNT(*) as totalFiles,
  //     COUNT(CASE WHEN presentInA = 1 AND presentInB = 1 THEN 1 END) as syncedFiles,
  //     COUNT(CASE WHEN conflictState = 'conflict' THEN 1 END) as conflictedFiles,
  //     COUNT(CASE WHEN presentInA = 1 AND presentInB = 0 THEN 1 END) as onlyInA,
  //     COUNT(CASE WHEN presentInA = 0 AND presentInB = 1 THEN 1 END) as onlyInB
  //   FROM files
  //   WHERE deletedAt IS NULL
  // `),
  // getRecentActivity: (limit: number = 10) =>
  //   queryDb(state.files.select(['id', 'modifiedAt', 'lastSyncedAt'])
  //     .orderBy('modifiedAt', 'desc')
  //     .limit(limit)),
}

// Export all queries
export const queries = {
  ...fileQueries,
  ...conflictQueries,
  ...syncQueries,
}
