import { Schema } from '@livestore/utils/effect'

import { DbSchema } from '../schema/index.js'

export const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
  { enableCud: true },
)

const Config = Schema.Struct({
  fontSize: Schema.Number,
  theme: Schema.Literal('light', 'dark'),
})

export const appConfig = DbSchema.table('app_config', DbSchema.json({ schema: Config, nullable: true }), {
  isSingleton: true,
  enableCud: true,
})
