import { BootStatus, UnexpectedError } from '@livestore/common'
import { DbSchema, makeSchema } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
  { deriveMutations: true },
)

export const schema = makeSchema({ tables: [todos] })

export namespace Bridge {
  export class Result extends Schema.TaggedStruct('Bridge.Result', {
    exit: Schema.Exit({
      success: Schema.Struct({
        bootStatusUpdates: Schema.Array(BootStatus),
      }),
      failure: UnexpectedError,
      defect: Schema.Defect,
    }),
  }) {}
}
