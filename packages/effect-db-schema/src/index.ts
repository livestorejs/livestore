// import * as Schema from '@effect/schema/Schema'

// import * as sqlite from './dsl/sqlite/index.js'
export * as sqlite from './dsl/sqlite/index.js'

// const main = () => {
//   // const UserMetaInfo = Schema.struct({
//   //   createdAt: Schema.dateFromString(Schema.string),
//   //   updatedAt: Schema.dateFromString(Schema.string),
//   // })

//   class UserMetaInfo extends Schema.Class<UserMetaInfo>()({
//     createdAt: Schema.dateFromString(Schema.string),
//     updatedAt: Schema.dateFromString(Schema.string),
//   }) {}

//   const User = Schema.struct({
//     id: Schema.string,
//     metaInfo: UserMetaInfo,
//     isCool: Schema.boolean,
//   })

//   const users = sqlite.table('users', {
//     id: sqlite.text({ primaryKey: true }),
//     metaInfo: sqlite.json({ schema: UserMetaInfo }),
//     isCool: sqlite.boolean({ nullable: true }),
//     createdAt: sqlite.datetime({ nullable: true, default: new Date() }),
//   })

//   const dbSchema = sqlite.defineDbSchema({ users })

//   type _UsersColumns = sqlite.GetColumns<typeof users>
//   type _UsersEncoded = sqlite.GetRowEncoded<typeof users>
//   type _UsersDecoded = sqlite.GetRowDecoded<typeof users>

//   console.log('ast', dbSchema.users.ast)

//   // magicFunction(User) ->

//   /*

// 	const correspondingDrizzle = sqliteTable('users', {
// 		id: text('id').primaryKey().nullable(false),  // 'id' is the column name
// 		metaInfo: json('metaInfo').nonNullable(),
// 	})

// 	*/

//   // console.log('userTable', userTableAst)

//   // console.log('metainfo ast', userTableAst.columns[1]!.codec!)
// }

// main()
