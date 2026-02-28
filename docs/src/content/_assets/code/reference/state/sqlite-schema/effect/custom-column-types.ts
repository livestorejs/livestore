import { Schema, State } from '@livestore/livestore'

const _schema = Schema.Struct({
  // Store a number as text instead of real
  version: Schema.Number.pipe(State.SQLite.withColumnType('text')),
  // Store binary data as blob
  data: Schema.Uint8Array.pipe(State.SQLite.withColumnType('blob')),
})
