## Local setup

```sh
# Install deps and build libs
pnpm install
pnpm build

# Run the example app
cd examples/todomvc
pnpm dev
```

## Concepts

LiveStore provides a highly structured data model for your React components. It helps you clearly reason about data dependencies, leverage the relational model and the power of SQLite, and persist UI state.

## Reads

To define the data used by a component, you use the `useLiveStoreComponent` hook. There are 3 parts to defining the data:

- **local state**: This is the equivalent of `React.useState`, but in a relational style. Each component instance gets a row in a database table to store local state. You define the schema for the table that stores this component state. In your component, you can read/write local state.
- **reactive queries**: Often it's not enough to just read/write local state, you also need to query data in the global database (eg, table of todos, or table of music tracks). To do this, you can define reactive SQL or GraphQL queries. The query strings can be _dynamic_ and depend on local state or other queries. You can also `.pipe` the results of any SQL or GraphQL query to do further downstream transformations.
- **component key**: Every LiveStore component needs to have a _component key_ defined. This defines an identity for each instance of the component. Any component instances with the same key will share their local state / reactive queries.

Let's see an example. This doesn't have any local state, just queries and a component key. (TODO: add an example with local state.)

We have a todos app which has a global table called `app`, which always has one row. It has a column called `filter` which has the value `active`, `completed`, or `all`. We want to use this value to query for only the todos which should be visible with that filter. Here's the code:

```ts
const [{ visibleTodos }] = useLiveStoreComponent({
  // Define the reactive queries for this component
  createQueries: ({ createSQL }) => {
    // First, we create a reactive query which defines the filter clause for the SQL query.
    // It gets the first row from the app table, and pipes them into a transform function.
    // The result is a reactive query whose value is a string containing the filter clause.
    const filterClause = createSQL<AppState[]>(() => `select * from app;`)
      .getFirstRow()
      .pipe((appState) => (appState.filter === 'all' ? '' : `where completed = ${appState.filter === 'active'}`))

    // Next, we create the actual query for the visible todos.
    // We create a new reactive SQL query which interpolates the filterClause.
    // Notice how we call filterClause() as a function--
    // that gets the latest value of that reactive query.
    const visibleTodos = createSQL<Todo[]>((get) => sql`select * from todos ${filterClause()}`)

    return { visibleTodos }
  },

  // For this particular component, we use a singleton key.
  componentKey: { name: 'MainSection', key: 'singleton' },
})
```

## Writes

Writes happen through actions: structured mutations on the LiveStore datastore. Think closer to Redux-style actions at the domain level, rather than low-level SQL writes. This makes it clearer what's going on in the code, and enables other things like sync / undo in the future.

Write actions can be accessed via the `useLiveStoreActions` hook. This is global and not component-scoped. (If you want to do a write that references some local state, you can just pass it in to the action arguements.)

```ts
const { completeTodo, uncompleteTodo, deleteTodo } = useLiveStoreActions()

// We record an event that specifies marking complete or incomplete,
// The reason is that this better captures the user's intention
// when the event gets synced across multiple devices--
// If another user toggled concurrently, we shouldn't toggle it back
const toggleTodo = (todo: Todo) => {
  if (!todo.completed) {
    completeTodo({ id: todo.id })
  } else {
    uncompleteTodo({ id: todo.id })
  }
}
```

## Defining dependencies

LiveStore tracks which tables are read by each query and written by each action, in order to determine which queries need to be re-run in response to each write.

In the future we want to do this more automatically via analysis of queries, but currently this write/read table tracking is done manually. It's very important to correctly annotate write and reads with table names, otherwise reactive updates won't work correctly.

Here's how writes and reads are annotated.

**Write actions**: annotate the SQL statement in the action definition, like this:

```ts
newPlayerContext: {
  statement: ({ contextId }) => {
    return {
      sql: sql`insert into player_context (id, timestamp) values ('${contextId}', ${Date.now()})`,
      writeTables: ['player_context'],
    }
  },
},
```

**GraphQL:** annotate the query in the resolver, like this:

```ts
spotifyAlbum = (albumId: string) => {
  this.queriedTables.add('album_images').add('albums')

  const albums = this.db.select<AlbumSrc>(sql`
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
