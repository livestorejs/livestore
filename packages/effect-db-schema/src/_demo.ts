import * as Schema from '@effect/schema/Schema'

import * as sqlite from './dsl/sqlite/index.js'

const main = () => {
  class UserMetaInfo extends Schema.Class<UserMetaInfo>('UserMetaInfo')({
    createdAt: Schema.Date,
    updatedAt: Schema.Date,
  }) {}

  const State = Schema.union(Schema.literal('active'), Schema.literal('inactive'))

  const users = sqlite.table('users', {
    id: sqlite.text({ primaryKey: true }),
    metaInfo: sqlite.json({ schema: UserMetaInfo }),
    isCool: sqlite.boolean({ nullable: true }),
    createdAt: sqlite.datetime({ nullable: true, default: new Date() }),
    state: sqlite.json({ schema: State }),
  })

  const dbSchema = sqlite.makeDbSchema([users])

  type _UsersColumns = sqlite.FromTable.Columns<typeof users>
  type _UsersEncoded = sqlite.FromTable.RowEncoded<typeof users>
  type _User = sqlite.FromTable.RowDecoded<typeof users>

  console.log('ast', dbSchema.users.ast)
}

main()
