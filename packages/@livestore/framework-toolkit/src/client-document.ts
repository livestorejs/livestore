import { State } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'

/**
 * Validates that a table is a client document table.
 * Throws if the table is not a client document table.
 *
 * @param table - The table definition to validate
 * @throws If the table is not a client document table
 */
export const validateTableOptions = (table: State.SQLite.TableDef<any, any>): void => {
  if (!State.SQLite.tableIsClientDocumentTable(table)) {
    shouldNeverHappen(
      `useClientDocument called on table "${table.sqliteDef.name}" which is not a client document table`,
    )
  }
}

/**
 * Removes undefined values from an object.
 * Returns non-object values unchanged.
 *
 * @param value - The value to process
 * @returns The value with undefined properties removed (if object)
 */
export const removeUndefinedValues = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined)) as T
  }

  return value
}
