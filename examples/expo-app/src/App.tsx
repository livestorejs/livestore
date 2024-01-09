import { sql } from '@livestore/livestore'
import type { DatabaseApi } from '@livestore/livestore/react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import * as SQLite from 'expo-sqlite/next'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { ListTodos } from './components/ListTodos.tsx'
import { NewTodo } from './components/NewTodo.tsx'
import { schema } from './schema/index.ts'

export const notYetImplemented = (msg?: string): never => {
  throw new Error(`Not yet implemented ${msg}`)
}

const db = SQLite.openDatabaseSync('databaseName5.db')

const sqlite3Instance: DatabaseApi = {
  filename: 'whatever',
  pointer: 0,
  exec: () => notYetImplemented(),
  prepare: (value) => db.prepareSync(value),
  isOpen: () => notYetImplemented(),
  affirmOpen: () => notYetImplemented(),
  close: () => notYetImplemented(),
  changes: () => notYetImplemented(),

  dbFilename: () => notYetImplemented(),
  dbName: () => notYetImplemented(),
  dbVfsName: (_dbName: any) => notYetImplemented(),
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

export const App = () => {
  return (
    <View style={styles.container}>
      <LiveStoreProvider
        schema={schema}
        loadStorage={() => () => {
          return {
            execute: () => undefined,
            mutate: () => undefined,
            getPersistedData: () => Promise.resolve(new Uint8Array()),
            getMutationLogData: () => Promise.resolve(new Uint8Array()),
            dangerouslyReset: () => Promise.resolve(),
          }
        }}
        fallback={<Text>Loading...</Text>}
        boot={(db) => {
          db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'call johannes', 1)`)
        }}
        sqlite3={sqlite3Instance}
      >
        <NewTodo />
        <ListTodos />
      </LiveStoreProvider>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
