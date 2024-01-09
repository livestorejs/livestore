import * as SQLite from 'expo-sqlite/next'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

import { schema } from './schema'

console.log(schema)

const load = async () => {
  const db = await SQLite.openDatabaseAsync('databaseName')
  console.log('DATABASE:', db)

  db.execSync(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL, intValue INTEGER);
INSERT INTO test (value, intValue) VALUES ('test1', 123);
INSERT INTO test (value, intValue) VALUES ('test2', 456);
INSERT INTO test (value, intValue) VALUES ('test3', 789);
`)

  const allRows = await db.getAllSync('SELECT * FROM test')
  for (const row of allRows) {
    console.log(row.id, row.value, row.intValue)
  }
}

load()

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Hello!</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
