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

const dbFilename = 'databaseName6.db'
const db = SQLite.openDatabaseSync(dbFilename)

const sqlite3Instance: DatabaseApi = {
  filename: dbFilename,
  prepare: (value) => {
    const stmt = db.prepareSync(value)
    return {
      execute: (bindValues) => {
        const res = stmt.executeSync(bindValues ?? [])
        res.resetSync()
      },
      select: (bindValues) => {
        const res = stmt.executeSync(bindValues ?? [])
        try {
          return res.getAllSync() as any
        } finally {
          res.resetSync()
        }
      },
      finalize: () => stmt.finalizeSync(),
    }
  },
  export: () => {
    console.error(`export not yet implemented`)
    return new Uint8Array([])
  },
}

export const App = () => {
  return (
    <View style={styles.container}>
      <LiveStoreProvider
        schema={schema}
        fallback={<Text>Loading...</Text>}
        boot={(db) => {
          db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'call johannes', 1)`)
        }}
        sqlite3={() => sqlite3Instance}
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
