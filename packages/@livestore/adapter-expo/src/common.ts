import type { SqliteDb } from '@livestore/common'
import { base64 } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import * as ExpoFS from 'expo-file-system'
import type * as SQLite from 'expo-sqlite'

export type DbPairRef = {
  current:
    | {
        db: SQLite.SQLiteDatabase
        sqliteDb: SqliteDb
      }
    | undefined
}

export const getDbFilePath = (dbName: string) => {
  return `${ExpoFS.documentDirectory}SQLite/${dbName}`
}

export const overwriteDbFile = (dbName: string, data: Uint8Array) =>
  Effect.gen(function* () {
    const path = getDbFilePath(dbName)

    yield* Effect.promise(() => ExpoFS.deleteAsync(path, { idempotent: true }))

    // TODO avoid converting to string once the ExpoFS API supports binary data
    const b64String = base64.encode(data)
    yield* Effect.promise(() => ExpoFS.writeAsStringAsync(path, b64String, { encoding: ExpoFS.EncodingType.Base64 }))
  })
