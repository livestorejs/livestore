import { Events, Schema } from '@livestore/livestore'

export const events = {
  createTask: Events.synced({
    name: 'v1.CreateTask',
    schema: Schema.Struct({
      title: Schema.String,
      order: Schema.String,
    }),
  }),
  updateTaskOrder: Events.synced({
    name: 'v1.UpdateTaskOrder',
    schema: Schema.Struct({
      id: Schema.Number,
      order: Schema.String,
    }),
  }),
}
