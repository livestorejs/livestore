import { Schema } from '@livestore/livestore'

// which is equivalent to (if you have `effect` as a dependency)
// import { Schema } from 'effect'

// Example usage
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

// Type can be derived as: typeof User.Type
export type UserType = typeof User.Type
