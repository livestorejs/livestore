export const blogSchemaContent = `import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// Content management with collaborative editing capabilities
export const tables = {
  posts: State.SQLite.table({
    name: 'posts',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
      content: State.SQLite.text(), // Consider using JSON for rich text operations
      slug: State.SQLite.text(),
      published: State.SQLite.boolean({ default: false }),
      authorId: State.SQLite.text(),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      publishedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      version: State.SQLite.integer({ default: 1 }), // For optimistic concurrency
    },
  }),
  
  comments: State.SQLite.table({
    name: 'comments',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      postId: State.SQLite.text(),
      authorId: State.SQLite.text(),
      content: State.SQLite.text(),
      parentId: State.SQLite.text({ nullable: true }), // For threaded comments
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      editedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  authors: State.SQLite.table({
    name: 'authors',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      email: State.SQLite.text(),
      bio: State.SQLite.text({ nullable: true }),
      avatarUrl: State.SQLite.text({ nullable: true }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  // Track collaborative editing sessions
  editingSessions: State.SQLite.clientDocument({
    name: 'editingSessions',
    schema: Schema.Struct({
      postId: Schema.String,
      authorId: Schema.String,
      lastActivity: Schema.Date,
      cursorPosition: Schema.Number,
    }),
    default: { 
      id: SessionIdSymbol, 
      value: { postId: '', authorId: '', lastActivity: new Date(), cursorPosition: 0 }
    },
  }),
}

export const events = {
  // Post lifecycle events
  postCreated: Events.synced({
    name: 'v1.PostCreated',
    schema: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      slug: Schema.String,
      authorId: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  postTitleChanged: Events.synced({
    name: 'v1.PostTitleChanged',
    schema: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      version: Schema.Number, // Optimistic concurrency control
    }),
  }),
  
  postContentChanged: Events.synced({
    name: 'v1.PostContentChanged',
    schema: Schema.Struct({
      id: Schema.String,
      content: Schema.String,
      version: Schema.Number,
      authorId: Schema.String,
    }),
  }),
  
  postPublished: Events.synced({
    name: 'v1.PostPublished',
    schema: Schema.Struct({
      id: Schema.String,
      publishedAt: Schema.Date,
    }),
  }),
  
  postUnpublished: Events.synced({
    name: 'v1.PostUnpublished',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  
  postDeleted: Events.synced({
    name: 'v1.PostDeleted',
    schema: Schema.Struct({
      id: Schema.String,
      deletedAt: Schema.Date,
    }),
  }),
  
  // Comment events
  commentCreated: Events.synced({
    name: 'v1.CommentCreated',
    schema: Schema.Struct({
      id: Schema.String,
      postId: Schema.String,
      authorId: Schema.String,
      content: Schema.String,
      parentId: Schema.NullOr(Schema.String),
      createdAt: Schema.Date,
    }),
  }),
  
  commentEdited: Events.synced({
    name: 'v1.CommentEdited',
    schema: Schema.Struct({
      id: Schema.String,
      content: Schema.String,
      editedAt: Schema.Date,
    }),
  }),
  
  commentDeleted: Events.synced({
    name: 'v1.CommentDeleted',
    schema: Schema.Struct({
      id: Schema.String,
      deletedAt: Schema.Date,
    }),
  }),
  
  // Author events
  authorCreated: Events.synced({
    name: 'v1.AuthorCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  // Local editing session tracking
  editingSessionUpdated: tables.editingSessions.set,
}

// Materializers with conflict resolution strategies
const materializers = State.SQLite.materializers(events, {
  // Post materializers
  'v1.PostCreated': ({ id, title, slug, authorId, createdAt }) =>
    tables.posts.insert({ id, title, content: '', slug, authorId, createdAt, version: 1 }),
    
  'v1.PostTitleChanged': ({ id, title, version }) =>
    // Last-write-wins with version check for optimistic concurrency
    tables.posts.update({ title, version }).where({ id }),
    
  'v1.PostContentChanged': ({ id, content, version, authorId }) =>
    tables.posts.update({ content, version }).where({ id }),
    
  'v1.PostPublished': ({ id, publishedAt }) =>
    tables.posts.update({ published: true, publishedAt }).where({ id }),
    
  'v1.PostUnpublished': ({ id }) =>
    tables.posts.update({ published: false, publishedAt: null }).where({ id }),
    
  'v1.PostDeleted': ({ id, deletedAt }) =>
    tables.posts.update({ deletedAt }).where({ id }),
    
  // Comment materializers
  'v1.CommentCreated': ({ id, postId, authorId, content, parentId, createdAt }) =>
    tables.comments.insert({ id, postId, authorId, content, parentId, createdAt }),
    
  'v1.CommentEdited': ({ id, content, editedAt }) =>
    tables.comments.update({ content, editedAt }).where({ id }),
    
  'v1.CommentDeleted': ({ id, deletedAt }) =>
    tables.comments.update({ deletedAt }).where({ id }),
    
  // Author materializers
  'v1.AuthorCreated': ({ id, name, email, createdAt }) =>
    tables.authors.insert({ id, name, email, createdAt }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Example queries:
//
// // Published posts with author info
// const publishedPosts$ = queryDb(
//   tables.posts
//     .select()
//     .join(tables.authors, 'authorId', 'id')
//     .where({ published: true, deletedAt: null })
//     .orderBy('publishedAt', 'desc'),
//   { label: 'publishedPosts' }
// )
//
// // Comments for a post (threaded)
// const postComments$ = (postId: string) => queryDb(
//   tables.comments
//     .select()
//     .join(tables.authors, 'authorId', 'id') 
//     .where({ postId, deletedAt: null })
//     .orderBy('createdAt'),
//   { label: \`postComments-\${postId}\` }
// )`
