import type { StateBackendId } from '@livestore/common/schema'

export const makeTableKey = (backendId: StateBackendId, tableName: string): string => `${backendId}:${tableName}`

export const resolveTableKey = ({
  tableName,
  defaultBackendId,
}: {
  tableName: string
  defaultBackendId: StateBackendId
}): string => (tableName.includes(':') ? tableName : makeTableKey(defaultBackendId, tableName))
