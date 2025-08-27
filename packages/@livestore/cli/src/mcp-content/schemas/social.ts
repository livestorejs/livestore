export const socialSchemaContent = `import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// Social network with activity feeds and real-time interactions
export const tables = {
  users: State.SQLite.table({
    name: 'users',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      username: State.SQLite.text(),
      email: State.SQLite.text(),
      displayName: State.SQLite.text(),
      bio: State.SQLite.text({ nullable: true }),
      avatarUrl: State.SQLite.text({ nullable: true }),
      isVerified: State.SQLite.boolean({ default: false }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      lastActiveAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      // Privacy settings
      isPrivate: State.SQLite.boolean({ default: false }),
      allowsFollowers: State.SQLite.boolean({ default: true }),
    },
  }),
  
  posts: State.SQLite.table({
    name: 'posts',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      authorId: State.SQLite.text(),
      content: State.SQLite.text(),
      mediaUrls: State.SQLite.text({ nullable: true }), // JSON array of media URLs
      replyToId: State.SQLite.text({ nullable: true }), // For threading
      visibility: State.SQLite.text({ default: 'public' }), // public, followers, private
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      editedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  follows: State.SQLite.table({
    name: 'follows',
    columns: {
      followerId: State.SQLite.text(),
      followingId: State.SQLite.text(),
      status: State.SQLite.text({ default: 'active' }), // active, pending, blocked
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      approvedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  
  likes: State.SQLite.table({
    name: 'likes',
    columns: {
      userId: State.SQLite.text(),
      postId: State.SQLite.text(),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  // Aggregate tables for performance (eventually consistent)
  postStats: State.SQLite.table({
    name: 'post_stats',
    columns: {
      postId: State.SQLite.text({ primaryKey: true }),
      likeCount: State.SQLite.integer({ default: 0 }),
      replyCount: State.SQLite.integer({ default: 0 }),
      shareCount: State.SQLite.integer({ default: 0 }),
      lastUpdated: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  userStats: State.SQLite.table({
    name: 'user_stats', 
    columns: {
      userId: State.SQLite.text({ primaryKey: true }),
      followerCount: State.SQLite.integer({ default: 0 }),
      followingCount: State.SQLite.integer({ default: 0 }),
      postCount: State.SQLite.integer({ default: 0 }),
      lastUpdated: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  // Client-side state for UI
  feedState: State.SQLite.clientDocument({
    name: 'feedState',
    schema: Schema.Struct({
      currentFeed: Schema.Literal('home', 'discover', 'following'),
      lastRefresh: Schema.Date,
      scrollPosition: Schema.Number,
    }),
    default: { 
      id: SessionIdSymbol, 
      value: { currentFeed: 'home', lastRefresh: new Date(), scrollPosition: 0 }
    },
  }),
}

export const events = {
  // User events
  userCreated: Events.synced({
    name: 'v1.UserCreated',
    schema: Schema.Struct({
      id: Schema.String,
      username: Schema.String,
      email: Schema.String,
      displayName: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  userProfileUpdated: Events.synced({
    name: 'v1.UserProfileUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      displayName: Schema.NullOr(Schema.String),
      bio: Schema.NullOr(Schema.String),
      avatarUrl: Schema.NullOr(Schema.String),
    }),
  }),
  
  userPrivacySettingsChanged: Events.synced({
    name: 'v1.UserPrivacySettingsChanged',
    schema: Schema.Struct({
      id: Schema.String,
      isPrivate: Schema.Boolean,
      allowsFollowers: Schema.Boolean,
    }),
  }),
  
  userLastActiveUpdated: Events.synced({
    name: 'v1.UserLastActiveUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      lastActiveAt: Schema.Date,
    }),
  }),
  
  // Post events
  postCreated: Events.synced({
    name: 'v1.PostCreated',
    schema: Schema.Struct({
      id: Schema.String,
      authorId: Schema.String,
      content: Schema.String,
      mediaUrls: Schema.NullOr(Schema.Array(Schema.String)),
      replyToId: Schema.NullOr(Schema.String),
      visibility: Schema.Literal('public', 'followers', 'private'),
      createdAt: Schema.Date,
    }),
  }),
  
  postEdited: Events.synced({
    name: 'v1.PostEdited',
    schema: Schema.Struct({
      id: Schema.String,
      content: Schema.String,
      editedAt: Schema.Date,
    }),
  }),
  
  postDeleted: Events.synced({
    name: 'v1.PostDeleted',
    schema: Schema.Struct({
      id: Schema.String,
      deletedAt: Schema.Date,
    }),
  }),
  
  // Social interaction events
  followRequested: Events.synced({
    name: 'v1.FollowRequested',
    schema: Schema.Struct({
      followerId: Schema.String,
      followingId: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  followApproved: Events.synced({
    name: 'v1.FollowApproved',
    schema: Schema.Struct({
      followerId: Schema.String,
      followingId: Schema.String,
      approvedAt: Schema.Date,
    }),
  }),
  
  unfollowed: Events.synced({
    name: 'v1.Unfollowed',
    schema: Schema.Struct({
      followerId: Schema.String,
      followingId: Schema.String,
    }),
  }),
  
  postLiked: Events.synced({
    name: 'v1.PostLiked',
    schema: Schema.Struct({
      userId: Schema.String,
      postId: Schema.String,
      createdAt: Schema.Date,
    }),
  }),
  
  postUnliked: Events.synced({
    name: 'v1.PostUnliked',
    schema: Schema.Struct({
      userId: Schema.String,
      postId: Schema.String,
    }),
  }),
  
  // Local UI state
  feedStateUpdated: tables.feedState.set,
}

// Materializers with eventual consistency for aggregates
const materializers = State.SQLite.materializers(events, {
  // User materializers
  'v1.UserCreated': ({ id, username, email, displayName, createdAt }) => [
    tables.users.insert({ id, username, email, displayName, createdAt }),
    tables.userStats.insert({ userId: id, lastUpdated: createdAt }),
  ],
  
  'v1.UserProfileUpdated': ({ id, displayName, bio, avatarUrl }) =>
    tables.users.update({ displayName, bio, avatarUrl }).where({ id }),
    
  'v1.UserPrivacySettingsChanged': ({ id, isPrivate, allowsFollowers }) =>
    tables.users.update({ isPrivate, allowsFollowers }).where({ id }),
    
  'v1.UserLastActiveUpdated': ({ id, lastActiveAt }) =>
    tables.users.update({ lastActiveAt }).where({ id }),
    
  // Post materializers
  'v1.PostCreated': ({ id, authorId, content, mediaUrls, replyToId, visibility, createdAt }) => [
    tables.posts.insert({ 
      id, 
      authorId, 
      content, 
      mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      replyToId, 
      visibility, 
      createdAt 
    }),
    tables.postStats.insert({ postId: id, lastUpdated: createdAt }),
    // Update user post count
    tables.userStats.update({ 
      postCount: tables.userStats.select('postCount').where({ userId: authorId }).scalar() + 1,
      lastUpdated: createdAt
    }).where({ userId: authorId }),
  ],
  
  'v1.PostEdited': ({ id, content, editedAt }) =>
    tables.posts.update({ content, editedAt }).where({ id }),
    
  'v1.PostDeleted': ({ id, deletedAt }) =>
    tables.posts.update({ deletedAt }).where({ id }),
    
  // Follow materializers
  'v1.FollowRequested': ({ followerId, followingId, createdAt }) =>
    tables.follows.insert({ followerId, followingId, status: 'pending', createdAt }),
    
  'v1.FollowApproved': ({ followerId, followingId, approvedAt }) => [
    tables.follows.update({ status: 'active', approvedAt }).where({ followerId, followingId }),
    // Update follower counts
    tables.userStats.update({ 
      followerCount: tables.userStats.select('followerCount').where({ userId: followingId }).scalar() + 1,
      lastUpdated: approvedAt
    }).where({ userId: followingId }),
    tables.userStats.update({ 
      followingCount: tables.userStats.select('followingCount').where({ userId: followerId }).scalar() + 1,
      lastUpdated: approvedAt
    }).where({ userId: followerId }),
  ],
  
  'v1.Unfollowed': ({ followerId, followingId }) => [
    tables.follows.delete().where({ followerId, followingId }),
    // Update follower counts (eventual consistency)
    tables.userStats.update({ 
      followerCount: Math.max(0, tables.userStats.select('followerCount').where({ userId: followingId }).scalar() - 1),
      lastUpdated: new Date()
    }).where({ userId: followingId }),
    tables.userStats.update({ 
      followingCount: Math.max(0, tables.userStats.select('followingCount').where({ userId: followerId }).scalar() - 1),
      lastUpdated: new Date()
    }).where({ userId: followerId }),
  ],
  
  // Like materializers (idempotent)
  'v1.PostLiked': ({ userId, postId, createdAt }) => [
    tables.likes.insert({ userId, postId, createdAt }),
    // Update like count
    tables.postStats.update({ 
      likeCount: tables.postStats.select('likeCount').where({ postId }).scalar() + 1,
      lastUpdated: createdAt
    }).where({ postId }),
  ],
  
  'v1.PostUnliked': ({ userId, postId }) => [
    tables.likes.delete().where({ userId, postId }),
    // Update like count
    tables.postStats.update({ 
      likeCount: Math.max(0, tables.postStats.select('likeCount').where({ postId }).scalar() - 1),
      lastUpdated: new Date()
    }).where({ postId }),
  ],
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Example queries for activity feeds:
//
// // Home feed - posts from followed users
// const homeFeed$ = (userId: string) => queryDb(
//   tables.posts
//     .select()
//     .join(tables.follows, 'authorId', 'followingId')
//     .join(tables.users, 'authorId', 'id')
//     .leftJoin(tables.postStats, 'id', 'postId')
//     .where({ 
//       followerId: userId, 
//       'follows.status': 'active',
//       'posts.deletedAt': null,
//       'posts.visibility': ['public', 'followers']
//     })
//     .orderBy('createdAt', 'desc')
//     .limit(50),
//   { label: \`homeFeed-\${userId}\` }
// )
//
// // User profile with stats
// const userProfile$ = (username: string) => queryDb(
//   tables.users
//     .select()
//     .leftJoin(tables.userStats, 'id', 'userId')
//     .where({ username }),
//   { label: \`userProfile-\${username}\` }
// )`
