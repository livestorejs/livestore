import type { DatabaseApi } from '@livestore/livestore/react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import * as SQLite from 'expo-sqlite/next'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { schema } from './schema'

// console.log(schema)

export const notYetImplemented = (msg?: string): never => {
  throw new Error(`Not yet implemented ${msg}`)
}

const db = SQLite.openDatabaseSync('databaseName4.db')

const sqlite3Instance: DatabaseApi = {
  filename: 'whatever',
  pointer: 0,
  exec: () => notYetImplemented(),
  prepare: (value) => {
    console.log('prepare', value, db)
    return db.prepareSync(value)
  },
  isOpen: () => notYetImplemented(),
  affirmOpen: () => notYetImplemented(),
  close: () => notYetImplemented(),
  changes: () => notYetImplemented(),

  dbFilename: () => notYetImplemented(),
  dbName: () => notYetImplemented(),
  dbVfsName: (dbName: any) => notYetImplemented(),
  createFunction: () => notYetImplemented(),

  selectValue: () => notYetImplemented(),
  selectValues: () => notYetImplemented(),
  selectArray: () => notYetImplemented(),
  selectObject: () => notYetImplemented(),
  selectArrays: () => notYetImplemented(),
  selectObjects: () => notYetImplemented(),

  openStatementCount: () => notYetImplemented(),
  transaction: () => notYetImplemented(),
  savepoint: () => notYetImplemented(),
  checkRc: () => notYetImplemented(),
}

const App = () => {
  return (
    <View style={styles.container}>
      <Text>Hello!</Text>
      <LiveStoreProvider
        schema={schema}
        loadStorage={() => () => {
          return {
            execute: () => undefined,
            getPersistedData: () => Promise.resolve(new Uint8Array()),
          }
        }}
        fallback={<Text>Loading...</Text>}
        // boot={(db) => {
        //   console.log('booting')
        //   return db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all')`)
        // }}
        sqlite3={sqlite3Instance}
      ></LiveStoreProvider>
      <StatusBar style="auto" />
    </View>
  )
}

export default App

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
