import { State } from '@livestore/livestore'

export const task = State.SQLite.table({
  name: 'task',
  columns: {
    id: State.SQLite.integer({ primaryKey: true }),
    title: State.SQLite.text({ default: '' }),
    completed: State.SQLite.integer({ default: 0 }),
    /** Fractional index for ordering tasks in the list */
    order: State.SQLite.text({ nullable: false, default: '' }),
  },
  indexes: [
    /** Index for efficient ordering queries */
    { name: 'task_order', columns: ['order'] },
  ],
  deriveEvents: true,
})

export type Task = typeof task.Type

export const tables = { task }
