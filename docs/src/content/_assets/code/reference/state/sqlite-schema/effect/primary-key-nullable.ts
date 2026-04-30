import { Schema, State } from '@livestore/livestore'

// ❌ This will throw an error at runtime because primary keys cannot be nullable
const _badSchema = Schema.Struct({
  id: Schema.NullOr(Schema.String).pipe(State.SQLite.withPrimaryKey),
})
