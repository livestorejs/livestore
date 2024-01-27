# Requirements

<!-- - Being able to map a Effect Schema to a db schema -->

- Being able to reuse a Effect Schema to a db schema through a magic function
- We want to be able to map multiple flavors, including representing a struct just as a string column, or a json column
- The system takes care of transforming the struct into the db shape and back
- Concrete DB flavours (e.g. SQLite, Postgres, etc) are implemented separately

### High-level API

```ts
export const User = Schema.struct({
  id: Schema.string,
  name: Schema.string,
})

const user: User = Schema.decodeSnyc({
  id: 'bob',
  name: 'Bob',
})(User)

// save user
await magicDbFunction.persist(user)

// get user
const myUser: User = await magicDbFunction.get(user)
```

### `tableFromStruct`: DB Table derived from Struct Schema

- Caveats
  - Only works for structs
  - No control of number types (always uses reals/floats)

### Codegen

```bash
dbcli codegen --schema ./src/db-schema.ts --output ./src/drizzle-db-schema.ts
```

```ts
import {gen} from 'framework'

gen(struct, './lol.ts')
```

## MVP
- 

## Contributors

- Thanks a lot to @timsuchanek for contributing the initial version of the Drizzle codegen tool