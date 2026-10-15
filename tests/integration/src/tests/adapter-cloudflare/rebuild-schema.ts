import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

/** A table rename selects a fresh state file through the normal schema fingerprint. */
export const makeRebuildSchema = ({
  upgraded,
  failAt,
  post,
}: {
  upgraded: boolean
  failAt?: string
  post?: () => Promise<void>
}) => {
  const attemptedEvents: string[] = []
  const attemptedHooks: string[] = []
  const todos = State.SQLite.table({
    name: upgraded === true ? 'rebuild_todos_v2' : 'rebuild_todos_v1',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
    },
  })
  const events = {
    created: Events.synced({
      name: 'created',
      schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
    }),
  }
  const materializers = State.SQLite.materializers(events, {
    created: ({ id, title }) => {
      attemptedEvents.push(id)
      if (id === failAt) throw new Error(`Rebuild fixture rejected ${id}`)
      return todos.insert({ id, title })
    },
  })
  const state = State.SQLite.makeState({
    tables: { todos },
    materializers,
    migrations: {
      hooks:
        post === undefined
          ? undefined
          : {
              init: (db) => {
                attemptedHooks.push('init')
                // Not a declared table: recovery must discard hook-created objects too.
                db.execute('CREATE TABLE rebuild_scratch (id INTEGER PRIMARY KEY)')
                db.execute('INSERT INTO rebuild_scratch VALUES (1)')
              },
              pre: (db) => {
                attemptedHooks.push('pre')
                db.execute('INSERT INTO rebuild_scratch VALUES (2)')
              },
              post: async (db) => {
                attemptedHooks.push('post')
                db.execute('INSERT INTO rebuild_scratch VALUES (3)')
                await post()
                db.execute(todos.insert({ id: 'post-hook', title: 'completed' }))
              },
            },
    },
  })
  return { schema: makeSchema({ events, state }), events, todos, attemptedEvents, attemptedHooks }
}
