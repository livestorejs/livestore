[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/RbMcjUAPd7)

## Local setup

```sh
# Install deps and build libs
pnpm install
pnpm build

# Run the example app
cd examples/todomvc
pnpm dev
```

## Caveats

- Only supports recent browser versions (Safari 17+, ...)
- Doesn't yet run in Next.js (easiest to use with Vite right now)

## Features

- Synchronous, transactional reads and writes
- Otel tracing built-in

## Concepts

LiveStore provides a highly structured data model for your React components. It helps you clearly reason about data dependencies, leverage the relational model and the power of SQLite, and persist UI state.

## Reads

To define the data used by a component, you use the `useQuery` hook. There are 2 parts to defining the data:

- **local state**: This is the equivalent of `React.useState`, but in a relational style. Each component instance gets a row in a database table to store local state. You define the schema for the table that stores this component state. In your component, you can read/write local state.
- **reactive queries**: Often it's not enough to just read/write local state, you also need to query data in the global database (eg, table of todos, or table of music tracks). To do this, you can define reactive SQL or GraphQL queries. The query strings can be _dynamic_ and depend on local state or other queries. You can also `.pipe` the results of any SQL or GraphQL query to do further downstream transformations.

Let's see an example. This doesn't have any local state, just queries.

We have a todos app which has a global table called `app`, which always has one row. It has a column called `filter` which has the value `active`, `completed`, or `all`. We want to use this value to query for only the todos which should be visible with that filter. Here's the code:

```ts
import { querySQL, sql } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'

const filterClause$ = querySQL<AppState[]>(`select * from app;`)
  .pipe(([appState]) => (appState.filter === 'all' ? '' : `where completed = ${appState.filter === 'completed'}`))

const visibleTodos$ = querySQL<Todo[]>((get) => sql`select * from todos ${get(filterClause$)}`)


export const MyApp: React.FC = () => {
  const visibleTodos = useQuery(visibleTodos$)

  return (
    // ...
  )
}
```

## Writes

Writes happen through mutations: structured mutations on the LiveStore datastore. Think closer to Redux-style mutations at the domain level, rather than low-level SQL writes. This makes it clearer what's going on in the code, and enables other things like sync / undo in the future.

Write mutations can be accessed via the `useLiveStoreActions` hook. This is global and not component-scoped. (If you want to do a write that references some local state, you can just pass it in to the mutation arguements.)

```ts
const { store } = useStore()

// We record an event that specifies marking complete or incomplete,
// The reason is that this better captures the user's intention
// when the event gets synced across multiple devices--
// If another user toggled concurrently, we shouldn't toggle it back
const toggleTodo = (todo: Todo) =>
  store.mutate(todo.completed ? mutations.uncompleteTodo({ id: todo.id }) : mutations.completeTodo({ id: todo.id }))
```

## Defining dependencies

LiveStore tracks which tables are read by each query and written by each mutation, in order to determine which queries need to be re-run in response to each write.

In the future we want to do this more automatically via analysis of queries, but currently this write/read table tracking is done manually. It's very important to correctly annotate write and reads with table names, otherwise reactive updates won't work correctly.

Here's how writes and reads are annotated.

**Write mutations**: annotate the SQL statement in the mutation definition, like this:

```ts
export const completeTodo = defineMutation(
  'completeTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)
```

**GraphQL:** annotate the query in the resolver, like this:

```ts
spotifyAlbum = (albumId: string) => {
  this.queriedTables.add('album_images').add('albums')

  const albums = this.db.select<AlbumSrc[]>(sql`
      select id, name,
      (
        select image_url
        from ${tableNames.album_images}
        where album_images.album_id = albums.id
        order by height desc -- use the big image for this view
        limit 1
      ) as image_url
      from albums
      where id = '${albumId}'
    `)

  return albums[0] ?? null
}
```

**SQL**: manual table annotation is not supported yet on queries, todo soon.
